/**
 * Orchestrates the update pipeline for download.versatiles.org.
 *
 * The `run()` function:
 * - discovers all `.versatiles` files on the Storage Box via SSH
 * - downloads or computes MD5/SHA256 sidecars for each file
 * - groups files into logical `FileGroup`s with metadata
 * - mirrors the data files to Cloudflare R2
 * - refreshes the `*.index.json` size indices for changed data files
 * - builds the static site (HTML, RSS, sidecars, url lists) and uploads it to R2
 *
 * Atomic publish: the data files are mirrored **before** the site is uploaded,
 * so the site never advertises a file that isn't fully present on R2.
 *
 * This module is the single entry point for one-shot updates (`run_once.ts`).
 */
import { loadConfig } from './config.js';
import { preflight } from './preflight.js';
import { getRemoteFiles } from './source/scan.js';
import { collectFiles, groupFiles } from './file/file_group.js';
import { generateHashes } from './file/hashes.js';
import { mirrorToR2 } from './mirror/rclone.js';
import { syncSizeIndices } from './size_index/sync.js';
import { buildAndUploadSite } from './site/site.js';

/**
 * Executes the update pipeline.
 *
 * Steps:
 * 1. Read and validate the configuration from the environment.
 * 2. Check that the Storage Box and both rclone remotes are reachable.
 * 3. Discover all `.versatiles` files on the Storage Box via SSH.
 * 4. Download or compute MD5/SHA256 sidecars for each file.
 * 5. Group files into `FileGroup`s and derive metadata.
 * 6. Mirror the data files to R2.
 * 7. Build and upload size indices for data files that changed.
 * 8. Build the static site and upload it to R2 (last).
 *
 * Throws:
 * - If the configuration is incomplete or invalid, or a connection check fails —
 *   before anything else runs.
 * - If no remote files are found.
 * - If any downstream step fails (hashing, grouping, mirroring, templating, upload).
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

	// Group files based on their names.
	const fileGroups = groupFiles(files);

	// Mirror the data files to R2 *before* publishing the site (atomic publish).
	const dataFiles = collectFiles(fileGroups);
	mirrorToR2(dataFiles);

	// Refresh the size indices used for download estimates. Reads the containers
	// back over HTTP, so it must run after the mirror; only rebuilds what changed.
	await syncSizeIndices(fileGroups, baseURL);

	// Build the static site (index.html, RSS, sidecars, url lists) and upload last.
	buildAndUploadSite(fileGroups, baseURL);

	console.log('Update complete.');
}
