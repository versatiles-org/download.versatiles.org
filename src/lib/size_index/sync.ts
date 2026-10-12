/**
 * Keeps the `*.index.json` size indices on R2 in sync with the data files.
 *
 * Each index sits next to the data file it describes, alongside the `.md5` /
 * `.sha256` sidecars:
 *
 *   /osm.versatiles              →  /osm.versatiles.index.json
 *   /osm.20260105.versatiles     →  /osm.20260105.versatiles.index.json
 *
 * Building an index takes roughly 20 minutes per planet-sized container, so an
 * index is only rebuilt when the data it describes has changed. Change detection
 * uses the **md5 recorded in the index object's metadata**, not the mere presence
 * of the object: each dataset is also published under a stable, undated key
 * (`/osm.versatiles`, `/satellite.versatiles`), and those keys are overwritten in
 * place on every release. A presence check would therefore pin a stale index
 * onto exactly the URLs the site links to.
 *
 * A release that is published under a dated and a stable key has its index
 * built once, for the dated key, and copied to the stable one within R2.
 *
 * Only the *latest* file of each group is indexed — older versions are shown in a
 * collapsed list and do not need an estimate. Which file that is, and when its
 * index is made, is decided in `../mirror/execute.ts`.
 */
import type { FileRef } from '../file/file_ref.js';
import { copyObject, remoteMd5, uploadObject } from '../mirror/rclone.js';
import { buildSizeIndex } from './build.js';

/** Suffix appended to a data file's key to get its size index key. */
const INDEX_SUFFIX = '.index.json';

/** The size index key belonging to a data file url. */
export function indexUrl(fileUrl: string): string {
	return `${fileUrl}${INDEX_SUFFIX}`;
}

/** True if the index stored for `file` describes exactly this version of it. */
export function isCurrent(file: FileRef): boolean {
	return remoteMd5(indexUrl(file.url)) === file.md5;
}

/**
 * Builds and uploads the size index of `file` unless the one on R2 is current.
 * Returns true if an index was built.
 *
 * `baseURL` is the public base the index is read through — the builder streams
 * the container over HTTP range requests, so the data file must already be on
 * R2 under `file.url` before this runs.
 *
 * Throws if the index cannot be built or uploaded.
 */
export async function ensureSizeIndex(file: FileRef, baseURL: string): Promise<boolean> {
	if (isCurrent(file)) return false;

	const source = new URL(file.url, baseURL).href;
	console.log(` - Building size index for ${file.filename} (${file.sizeString})`);

	let lastReported = 0;
	const index = await buildSizeIndex(source, (completed, total) => {
		const percent = Math.floor((completed / total) * 100);
		if (percent >= lastReported + 10 || completed === total) {
			lastReported = percent;
			console.log(`   ${completed}/${total} blocks (${percent}%)`);
		}
	});

	const content = JSON.stringify(index);
	console.log(` - Uploading ${indexUrl(file.url)} (${(content.length / 2 ** 20).toFixed(1)} MB)`);
	uploadObject(indexUrl(file.url), content, 'application/json', { md5: file.md5 });
	return true;
}

/**
 * Gives `to` the size index of `from` — the same bytes under another key — by
 * copying the index object within R2, unless `to` already has a current one.
 * Returns true if the index was copied.
 *
 * The index of `from` must exist (see {@link ensureSizeIndex}). The copy keeps
 * the md5 metadata, which is correct for `to` because both keys hold the same
 * data.
 */
export function copySizeIndex(from: FileRef, to: FileRef): boolean {
	if (isCurrent(to)) return false;

	console.log(` - Copying ${indexUrl(from.url)} -> ${indexUrl(to.url)} within R2`);
	copyObject(indexUrl(from.url), indexUrl(to.url));
	return true;
}
