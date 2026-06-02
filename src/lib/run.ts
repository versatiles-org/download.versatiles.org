/**
 * Orchestrates the update pipeline for download.versatiles.org.
 *
 * The `run()` function:
 * - discovers all `.versatiles` files on the Storage Box via SSH
 * - downloads or computes MD5/SHA256 sidecars for each file
 * - groups files into logical `FileGroup`s with metadata
 * - builds the static site (HTML, RSS, sidecars, url lists) and uploads it to R2
 *
 * This module is the single entry point for one-shot updates (`run_once.ts`).
 *
 * NOTE: This file is mid-migration (issue #22). Mirroring the data files to R2
 * (and the atomic-publish ordering — data first, site last) is wired in a later
 * phase; for now only the site upload is wired.
 */
import { getRemoteFiles } from './source/scan.js';
import { groupFiles } from './file/file_group.js';
import { generateHashes } from './file/hashes.js';
import { buildAndUploadSite } from './site/site.js';

/**
 * Configuration options for the `run()` pipeline.
 *
 * - `domain`: public domain name used to construct absolute URLs
 *   (falls back to the `DOMAIN` environment variable when omitted).
 */
export interface Options {
	domain?: string;
}

/**
 * Executes the update pipeline.
 *
 * Steps:
 * 1. Resolve `domain` from `options.domain` or the `DOMAIN` environment variable.
 * 2. Discover all `.versatiles` files on the Storage Box via SSH.
 * 3. Download or compute MD5/SHA256 sidecars for each file.
 * 4. Group files into `FileGroup`s and derive metadata.
 * 5. Build the static site and upload it to R2.
 *
 * Throws:
 * - If `domain` is missing (no `DOMAIN` env and no `options.domain` provided).
 * - If no remote files are found.
 * - If any downstream step fails (hashing, grouping, templating, upload).
 */
export async function run(options: Options = {}) {
	// Get the domain from environment variables. Throw an error if it's not set.
	const domain = options.domain ?? process.env['DOMAIN'];
	if (domain == null) throw Error('missing $DOMAIN');
	const baseURL = `https://${domain}/`;

	// Discover all .versatiles files on the Storage Box.
	const files = getRemoteFiles();

	// If no remote files are found, throw an error.
	if (files.length === 0) throw Error('no remote files found');

	// Download or compute MD5/SHA256 sidecars for each file.
	await generateHashes(files);

	// Group files based on their names.
	const fileGroups = groupFiles(files);

	// Build the static site (index.html, RSS, sidecars, url lists) and upload to R2.
	buildAndUploadSite(fileGroups, baseURL);
}
