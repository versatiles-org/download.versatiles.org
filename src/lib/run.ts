/**
 * Orchestrates the update pipeline for download.versatiles.org.
 *
 * The `run()` function:
 * - locates the volume folders (remote files, site output)
 * - discovers all `.versatiles` files in remote storage
 * - generates or loads checksum hashes for each file
 * - groups files into logical `FileGroup`s with metadata
 * - renders HTML (`index.html`) and RSS feeds for all groups
 *
 * This module is the single entry point for one-shot updates (`run_once.ts`).
 *
 * NOTE: This file is mid-migration (issue #22). The serving stack (nginx config
 * generation and the local SSD mirror) has been removed; mirroring data to
 * Cloudflare R2 and uploading the generated site are added in later phases.
 */
import { resolve } from 'path';
import { getAllFilesRecursive } from './file/file_ref.js';
import { groupFiles } from './file/file_group.js';
import { generateHashes } from './file/hashes.js';
import { generateHTML, generateRSSFeeds } from './template/template.js';

/**
 * Configuration options for the `run()` pipeline.
 *
 * - `domain`: public domain name used to construct absolute URLs
 *   (falls back to the `DOMAIN` environment variable when omitted).
 * - `volumeFolder`: root folder containing the expected subdirectories:
 *   - `remote_files/` — remote storage mount with `.versatiles` files
 *   - `local_files/` — output location for the generated site assets
 *
 * When `volumeFolder` is not provided, a default `volumes/` folder relative to
 * this module is used.
 */
export interface Options {
	domain?: string;
	volumeFolder?: string;
}

/**
 * Executes the update pipeline.
 *
 * Steps:
 * 1. Resolve `volumeFolder`, `remoteFolder`, and `localFolder`.
 * 2. Resolve `domain` from `options.domain` or the `DOMAIN` environment variable.
 * 3. Recursively discover all `.versatiles` files in `remoteFolder`.
 * 4. Generate or load MD5/SHA256 hashes for each file.
 * 5. Group files into `FileGroup`s and derive metadata.
 * 6. Generate `index.html` and per-group RSS feeds into `localFolder`.
 *
 * Throws:
 * - If `domain` is missing (no `DOMAIN` env and no `options.domain` provided).
 * - If no remote files are found in `remoteFolder`.
 * - If any downstream step fails (hashing, grouping, templating).
 */
export async function run(options: Options = {}) {
	// Define key folder paths for the volumes, remote files, and site output.
	const volumeFolder = options.volumeFolder ?? new URL('../../volumes/', import.meta.url).pathname;
	const remoteFolder = resolve(volumeFolder, 'remote_files'); // Folder containing remote files.
	const localFolder = resolve(volumeFolder, 'local_files'); // Folder for the generated site assets.

	// Get the domain from environment variables. Throw an error if it's not set.
	const domain = options.domain ?? process.env['DOMAIN'];
	if (domain == null) throw Error('missing $DOMAIN');

	// Get a list of all files in the remote folder recursively.
	const files = getAllFilesRecursive(remoteFolder);

	// If no remote files are found, throw an error.
	if (files.length === 0) throw Error('no remote files found');

	// Generate hashes for the files located in the remote folder.
	await generateHashes(files, remoteFolder);

	// Group files based on their names.
	const fileGroups = groupFiles(files);

	// Generate the static site (index.html + per-group RSS feeds).
	generateHTML(fileGroups, resolve(localFolder, 'index.html'));
	generateRSSFeeds(fileGroups, resolve(localFolder));
}
