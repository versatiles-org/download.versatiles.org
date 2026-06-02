/**
 * Builds the static site for download.versatiles.org and uploads it to R2.
 *
 * The site consists of small generated objects (no local serving):
 * - `/index.html` — the dataset overview page
 * - `/feed-<slug>.xml` — per-dataset RSS feeds
 * - `/<key>.md5` and `/<key>.sha256` — checksum sidecars (generated from the
 *   in-memory hashes, so their content carries the correct, possibly
 *   date-stripped key name — not the dated source name)
 * - `/urllist_<slug>.tsv` — TsvHttpData url list for the latest file
 *
 * All objects are uploaded via `uploadObject` (rclone `rcat`). Data files are
 * mirrored separately by `../mirror/rclone.ts`; per the atomic-publish ordering,
 * the site is uploaded only after the data is in place.
 */
import type { FileGroup } from '../file/file_group.js';
import type { FileResponse } from '../file/file_response.js';
import { generateHTML, generateRSSFeeds } from '../template/template.js';
import { uploadObject } from '../mirror/rclone.js';

/**
 * Generates all site objects for the given groups and uploads them to R2.
 *
 * `baseURL` is used to turn relative file paths into absolute URLs (e.g. in the
 * TSV url lists). Returns the number of objects uploaded.
 */
export function buildAndUploadSite(fileGroups: FileGroup[], baseURL: string): number {
	console.log('Building and uploading site assets...');

	const objects: FileResponse[] = [
		generateHTML(fileGroups),
		...generateRSSFeeds(fileGroups),
		...fileGroups.flatMap(group => group.getResponses(baseURL)),
	];

	for (const object of objects) {
		console.log(` - ${object.url}`);
		uploadObject(object.url, object.content, object.contentType);
	}

	console.log(` - ${objects.length} objects uploaded`);
	return objects.length;
}
