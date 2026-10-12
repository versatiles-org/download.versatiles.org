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
 *
 * Atomic publish: the data files are mirrored **before** the site is uploaded,
 * and the site is built from the files the plan says will be on R2 — so it never
 * advertises a file that isn't fully present there, also not while an upload is
 * deferred because of `MAX_UPLOAD_GB`.
 *
 * This module is the single entry point for one-shot updates (`run_once.ts`).
 */
import { loadConfig } from './config.js';
import { preflight } from './preflight.js';
import { getRemoteFiles } from './source/scan.js';
import { groupFiles } from './file/file_group.js';
import { generateHashes } from './file/hashes.js';
import { DeferredUploadsError, deferredFiles, describePlan, planMirror, planStableCopies } from './mirror/plan.js';
import { executeMirror } from './mirror/execute.js';
import { listRemoteDataFiles } from './mirror/rclone.js';
import { buildAndUploadSite } from './site/site.js';

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
 * 8. Build the static site and upload it to R2 (last).
 *
 * Throws:
 * - If the configuration is incomplete or invalid, or a connection check fails —
 *   before anything else runs.
 * - If no remote files are found, or none of them can be published.
 * - If any downstream step fails (hashing, mirroring, grouping, templating, upload).
 * - `DeferredUploadsError`, after everything else has been published, if
 *   uploads were skipped because of the size limit.
 */
export async function run() {
	// Validate everything up front: a missing R2 setting should not surface only
	// after the Storage Box has been scanned and hashed.
	const config = loadConfig();
	const baseURL = `https://${config.domain}/`;

	// Likewise for connectivity: check the Storage Box and both rclone remotes now.
	await preflight(config);

	// Discover all .versatiles files on the Storage Box.
	const scanned = getRemoteFiles();

	// If no remote files are found, throw an error.
	if (scanned.length === 0) throw Error('no remote files found');

	// Download or compute MD5/SHA256 sidecars for each file.
	await generateHashes(scanned);
	const files = scanned.map(({ file }) => file);

	// Decide what to do with each file before transferring anything.
	const remote = listRemoteDataFiles();
	const plan = planMirror(files, remote, { maxUploadBytes: config.maxUploadBytes });

	// Group what will be on R2 — not what was scanned: a deferred file is
	// represented by the version R2 still serves, or not at all.
	if (plan.published.length === 0) throw Error('none of the remote files can be published');
	const fileGroups = groupFiles(plan.published);
	const copies = planStableCopies(fileGroups, remote);

	console.log('Mirroring data files to R2...');
	console.log(describePlan(plan, copies));

	// Mirror the data files to R2 *before* publishing the site (atomic publish).
	// Dataset by dataset: uploads, checksums, size index, then the stable key.
	await executeMirror(fileGroups, plan, copies, baseURL);

	// Build the static site (index.html, RSS, sidecars, url lists) and upload last.
	buildAndUploadSite(fileGroups, baseURL);

	// Everything else is done; now report what this run was not allowed to do.
	const deferred = deferredFiles(plan);
	if (deferred.length > 0 && config.maxUploadBytes !== undefined) {
		throw new DeferredUploadsError(deferred, config.maxUploadBytes);
	}

	console.log('Update complete.');
}
