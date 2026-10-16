/**
 * Builds the static site for download.versatiles.org and uploads it to R2.
 *
 * The site is a SvelteKit app prerendered with `adapter-static`:
 * 1. write the file groups to `data/fileGroups.json` (consumed by the routes),
 * 2. run `vite build` → `build/` (index.html, `feed-<slug>.xml`, `_app/…` assets),
 * 3. upload `build/` to R2.
 *
 * The checksum sidecars (`<key>.md5` / `.sha256`), TSV url lists and
 * `catalog.json` are not part of the SvelteKit build — they are generated from the in-memory hashes and
 * uploaded as objects. Data files are mirrored separately (see `../mirror/`);
 * per the atomic-publish ordering, the site is published only after the data is
 * in place.
 *
 * The upload itself follows the same rule one level down: a page goes up only
 * after everything it refers to. `index.html` is therefore last — behind the
 * scripts and styles it loads, and behind the feeds and url lists it links.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { resolve } from 'path';
import type { FileGroup } from '../file/file_group.js';
import { uploadObject, uploadDir } from '../mirror/rclone.js';
import { buildCatalog } from '../file/catalog.js';

/** Folder of the build output that holds the scripts and styles of the pages. */
const ASSETS = '_app';

/**
 * Generates the static site for the given groups and uploads it to R2.
 *
 * `baseURL` is used to turn relative file paths into absolute URLs (in the TSV
 * url lists and the catalog). Returns the number of generated objects uploaded:
 * checksums, url lists and the catalog.
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

	// 3. Upload the generated checksum sidecars and url lists (not part of the build),
	//    then the catalog, which lists them.
	const objects = [...fileGroups.flatMap((group) => group.getResponses(baseURL)), buildCatalog(fileGroups, baseURL)];
	console.log(`Uploading ${objects.length} checksum/url-list/catalog objects...`);
	for (const object of objects) {
		uploadObject(object.url, object.content, object.contentType);
	}

	// 4. Upload the assets the pages load. Their names contain a content hash, so
	//    they sit beside those of the previous build without disturbing it.
	const buildDir = resolve('build');
	const assetsDir = resolve(buildDir, ASSETS);
	if (existsSync(assetsDir)) uploadDir(assetsDir, ASSETS);

	// 5. Upload the RSS feeds, as objects rather than with the directory: rclone
	//    would derive `text/xml` from the `.xml` extension.
	for (const group of fileGroups) {
		const feedPath = resolve(buildDir, `feed-${group.slug}.xml`);
		if (existsSync(feedPath)) {
			uploadObject(`/feed-${group.slug}.xml`, readFileSync(feedPath, 'utf-8'), 'application/rss+xml');
		}
	}

	// 6. Upload the pages last: index.html advertises everything above.
	uploadDir(buildDir, '', [`/${ASSETS}/**`, '/feed-*.xml']);

	console.log('Site published.');
	return objects.length;
}
