/**
 * Builds the static site for download.versatiles.org and uploads it to R2.
 *
 * The site is a SvelteKit app prerendered with `adapter-static`:
 * 1. write the file groups to `data/fileGroups.json` (consumed by the routes),
 * 2. run `vite build` → `build/` (index.html, `feed-<slug>.xml`, `_app/…` assets),
 * 3. upload `build/` to R2.
 *
 * The checksum sidecars (`<key>.md5` / `.sha256`) and TSV url lists are not part
 * of the SvelteKit build — they are generated from the in-memory hashes and
 * uploaded as objects. Data files are mirrored separately (see
 * `../mirror/rclone.ts`); per the atomic-publish ordering, the site is published
 * only after the data is in place.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { resolve } from 'path';
import type { FileGroup } from '../file/file_group.js';
import { uploadObject, uploadDir } from '../mirror/rclone.js';

/**
 * Generates the static site for the given groups and uploads it to R2.
 *
 * `baseURL` is used to turn relative file paths into absolute URLs (in the TSV
 * url lists). Returns the number of generated checksum/url-list objects uploaded.
 */
export function buildAndUploadSite(fileGroups: FileGroup[], baseURL: string): number {
	console.log('Building site...');

	// 1. Write the data file the SvelteKit routes read at build time.
	const dataDir = resolve('data');
	mkdirSync(dataDir, { recursive: true });
	writeFileSync(resolve(dataDir, 'fileGroups.json'), JSON.stringify(fileGroups));

	// 2. Prerender the static site.
	execSync('npx svelte-kit sync', { stdio: 'inherit' });
	execSync('npx vite build --logLevel warn', { stdio: 'inherit' });

	// 3. Upload the generated checksum sidecars and url lists (not part of the build).
	const objects = fileGroups.flatMap((group) => group.getResponses(baseURL));
	console.log(`Uploading ${objects.length} checksum/url-list objects...`);
	for (const object of objects) {
		uploadObject(object.url, object.content, object.contentType);
	}

	// 4. Upload the build output last (index.html advertises everything).
	uploadDir(resolve('build'));

	console.log('Site published.');
	return objects.length;
}
