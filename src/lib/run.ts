/**
 * Orchestrates the update pipeline for download.versatiles.org.
 *
 * The `run()` function:
 * - discovers all `.versatiles` files on the Storage Box via SSH
 * - downloads or computes MD5/SHA256 sidecars for each file
 * - plans the mirror against what is on R2
 * - groups the published files into logical `FileGroup`s with metadata
 * - per dataset, uploads what changed, refreshes the `*.index.json` size index
 *   and copies the latest release to its stable key within R2
 * - builds the static site (HTML, RSS, sidecars, url lists) and uploads it to R2
 * - deletes from R2 the releases older than the newest `RELEASES_KEPT`
 *
 * On the Storage Box it only ever writes missing `.md5` and `.sha256` sidecars;
 * it changes or deletes nothing else there.
 *
 * Atomic publish: the data files are mirrored **before** the site is uploaded,
 * and the site is built from the files the plan says will be on R2 — so it never
 * advertises a file that isn't fully present there, also not while an upload is
 * deferred because of `MAX_UPLOAD_GB`.
 *
 * This module is the single entry point for one-shot updates (`run_once.ts`).
 */
import { loadConfig, type Config } from './config.js';
import { acquireLock } from './lock.js';
import { preflight } from './preflight.js';
import { getRemoteFiles } from './source/scan.js';
import { RELEASES_KEPT, assertKnownDatasets, releasesBeyondLimit } from './file/datasets.js';
import { groupFiles, type FileGroup } from './file/file_group.js';
import type { FileRef } from './file/file_ref.js';
import { generateHashes } from './file/hashes.js';
import {
	DeferredUploadsError,
	deferredFiles,
	describePlan,
	planDeletions,
	planMirror,
	planStableCopies,
	releaseOf,
	type MirrorPlan,
} from './mirror/plan.js';
import { executeMirror } from './mirror/execute.js';
import { deleteRelease, listRemoteDataFiles } from './mirror/rclone.js';
import { isCurrent } from './size_index/sync.js';
import { buildAndUploadSite } from './site/site.js';

/** Options for {@link run}. */
export interface RunOptions {
	/**
	 * Report what an update would do and stop: nothing is written to the Storage
	 * Box, to R2 or to disk. Defaults to the `DRY_RUN` environment variable.
	 */
	dryRun?: boolean;
}

/**
 * Executes the update pipeline.
 *
 * Steps:
 * 1. Read and validate the configuration from the environment.
 * 2. Check that the Storage Box and both rclone remotes are reachable.
 * 3. Discover all `.versatiles` files on the Storage Box via SSH.
 * 4. Download or compute MD5/SHA256 sidecars for each file.
 * 5. Plan the mirror: what to upload, what is unchanged, what is deferred.
 * 6. Group the published files into `FileGroup`s and derive metadata.
 * 7. Per dataset: upload the changed files with their checksums, build the size
 *    index of the latest release, then copy that release to its stable key.
 * 8. Build the static site and upload it to R2.
 * 9. Delete the releases beyond the newest `RELEASES_KEPT` from R2 (last, so
 *    the site never links to a deleted file).
 *
 * A dry run stops after step 6 and prints the plan, deletions included, instead.
 *
 * Throws:
 * - If the configuration is incomplete or invalid, or a connection check fails —
 *   before anything else runs.
 * - If no remote files are found, one of them belongs to no known dataset, or
 *   none of them can be published.
 * - If any downstream step fails (hashing, mirroring, grouping, templating, upload).
 * - `DeferredUploadsError`, after everything else has been published, if
 *   uploads were skipped because of the size limit.
 */
export async function run(options: RunOptions = {}): Promise<void> {
	// Validate everything up front: a missing R2 setting should not surface only
	// after the Storage Box has been scanned and hashed.
	const config = loadConfig();
	const dryRun = options.dryRun ?? config.dryRun;

	// A dry run changes nothing, so it needs no lock and may run beside a real one.
	if (dryRun) return update(config, true);

	// Keep a second run on this host out: it would hash and upload the same files.
	const release = acquireLock();
	try {
		await update(config, false);
	} finally {
		release();
	}
}

/** The pipeline itself; see {@link run}. */
async function update(config: Config, dryRun: boolean): Promise<void> {
	const baseURL = `https://${config.domain}/`;

	// Likewise for connectivity: check the Storage Box and both rclone remotes now.
	await preflight(config);

	// Discover all .versatiles files on the Storage Box.
	const scanned = getRemoteFiles();

	// If no remote files are found, throw an error.
	if (scanned.length === 0) throw Error('no remote files found');

	// Stop at a file of no known dataset now, before hours of hashing are spent
	// on something that must not be published.
	assertKnownDatasets(scanned.map(({ file }) => file.filename));

	// Publish only the newest releases of each dataset. The older ones stay on the
	// Storage Box as they are and are not hashed, uploaded or listed.
	const beyondLimit = new Set(releasesBeyondLimit(scanned.map(({ file }) => file.filename)));
	for (const filename of beyondLimit) {
		console.log(` - skip   ${filename} — older than the newest ${RELEASES_KEPT} releases`);
	}
	const kept = scanned.filter(({ file }) => !beyondLimit.has(file.filename));

	// Download or compute MD5/SHA256 sidecars for each file. A dry run only reads
	// the sidecars that exist; files without them cannot be planned yet.
	const unhashed = await generateHashes(kept, { compute: !dryRun });
	const files = kept.map(({ file }) => file).filter((file) => file.hashes);

	// Decide what to do with each file before transferring anything.
	const remote = listRemoteDataFiles();
	const plan = planMirror(files, remote, { maxUploadBytes: config.maxUploadBytes });

	// Group what will be on R2 — not what was scanned: a deferred file is
	// represented by the version R2 still serves, or not at all.
	const fileGroups = groupFiles(plan.published);
	const copies = planStableCopies(fileGroups, remote);
	const deletions = planDeletions(plan.published, remote);

	if (dryRun) {
		console.log('Dry run — this is what an update would do:');
		console.log(describePlan(plan, copies, pendingIndices(fileGroups, plan), deletions));
		for (const file of unhashed) {
			console.log(
				` - hash   ${file.filename} (${file.sizeString}) — compute its checksums first; what follows is not known yet`,
			);
		}
		console.log(' - build and upload the site');
		console.log('Nothing was changed.');
		return;
	}

	if (fileGroups.length === 0) throw Error('none of the remote files can be published');

	console.log('Mirroring data files to R2...');
	console.log(describePlan(plan, copies, [], deletions));

	// Mirror the data files to R2 *before* publishing the site (atomic publish).
	// Dataset by dataset: uploads, checksums, size index, then the stable key.
	await executeMirror(fileGroups, plan, copies, baseURL);

	// Build the static site (index.html, RSS, sidecars, url lists) and upload it.
	buildAndUploadSite(fileGroups, baseURL);

	// Only now that the site no longer lists them, delete the old releases.
	for (const { url } of deletions) deleteRelease(url);

	// Everything else is done; now report what this run was not allowed to do.
	const deferred = deferredFiles(plan);
	if (deferred.length > 0 && config.maxUploadBytes !== undefined) {
		throw new DeferredUploadsError(deferred, config.maxUploadBytes);
	}

	console.log('Update complete.');
}

/**
 * The files whose size index an update would build: the latest release of each
 * group, if it is about to be uploaded or its index on R2 describes other data.
 */
function pendingIndices(groups: FileGroup[], plan: MirrorPlan): FileRef[] {
	const uploads = new Set(plan.actions.filter((action) => action.type === 'upload').map((action) => action.file.url));

	return groups.flatMap((group) => {
		const release = releaseOf(group) ?? group.latestFile;
		if (!release) return [];
		return uploads.has(release.url) || !isCurrent(release) ? [release] : [];
	});
}
