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
 * of the object: `groupFiles()` publishes each dataset under a stable, undated
 * key as well (`/osm.versatiles`, `/satellite.versatiles`), and those keys are
 * overwritten in place on every release. A presence check would therefore pin a
 * stale index onto exactly the URLs the site links to.
 *
 * Only the *latest* file of each group is indexed — older versions are shown in a
 * collapsed list and do not need an estimate.
 */
import { FileGroup } from '../file/file_group.js';
import { FileRef } from '../file/file_ref.js';
import { remoteMd5, uploadObject } from '../mirror/rclone.js';
import { buildSizeIndex } from './build.js';

/** Suffix appended to a data file's key to get its size index key. */
const INDEX_SUFFIX = '.index.json';

/** Result of a sync run. */
export interface SizeIndexStats {
	/** Number of indices built and uploaded. */
	built: number;
	/** Number of indices already current on R2 (skipped). */
	skipped: number;
}

/** The size index key belonging to a data file url. */
export function indexUrl(fileUrl: string): string {
	return `${fileUrl}${INDEX_SUFFIX}`;
}

/**
 * Builds and uploads a size index for the latest file of every group whose index
 * is missing or out of date.
 *
 * `baseURL` is the public base the indices are read through — the builder streams
 * the container over HTTP range requests, so the data files must already be
 * mirrored to R2 before this runs.
 *
 * Throws if an index cannot be built or uploaded.
 */
export async function syncSizeIndices(fileGroups: FileGroup[], baseURL: string): Promise<SizeIndexStats> {
	const stats: SizeIndexStats = { built: 0, skipped: 0 };

	console.log('Syncing size indices...');

	for (const [file, urls] of latestFilesByContent(fileGroups)) {
		const upToDate = urls.filter((url) => remoteMd5(indexUrl(url)) === file.md5);
		const stale = urls.filter((url) => !upToDate.includes(url));

		stats.skipped += upToDate.length;
		if (stale.length === 0) continue;

		// The same bytes are published under both a dated and a stable key, so
		// build once and upload the result to every key that needs it.
		const source = new URL(file.url, baseURL).href;
		console.log(` - Building index for ${file.filename} (${file.sizeString})`);

		let lastReported = 0;
		const index = await buildSizeIndex(source, (completed, total) => {
			const percent = Math.floor((completed / total) * 100);
			if (percent >= lastReported + 10 || completed === total) {
				lastReported = percent;
				console.log(`   ${completed}/${total} blocks (${percent}%)`);
			}
		});

		const content = JSON.stringify(index);
		for (const url of stale) {
			console.log(` - Uploading ${indexUrl(url)} (${(content.length / 2 ** 20).toFixed(1)} MB)`);
			uploadObject(indexUrl(url), content, 'application/json', { md5: file.md5 });
			stats.built++;
		}
	}

	console.log(` - ${stats.built} built, ${stats.skipped} unchanged`);
	return stats;
}

/**
 * Groups the latest file of every group by content (md5), mapping each distinct
 * file to all the urls it is published under.
 *
 * `groupFiles()` clones the newest file into `latestFile` with the date stripped
 * from its url, so one dataset is published under both `/osm.20260105.versatiles`
 * and `/osm.versatiles` — identical bytes, two keys. Building the index once per
 * url would double an already expensive step.
 */
function latestFilesByContent(fileGroups: FileGroup[]): Map<FileRef, string[]> {
	const byMd5 = new Map<string, { file: FileRef; urls: Set<string> }>();

	for (const group of fileGroups) {
		const latest = group.latestFile;
		if (!latest) continue;

		let entry = byMd5.get(latest.md5);
		if (!entry) {
			entry = { file: latest, urls: new Set() };
			byMd5.set(latest.md5, entry);
		}
		entry.urls.add(latest.url);

		// The dated original the stable url was cloned from, when it still exists.
		for (const older of group.olderFiles) {
			if (older.hashes && older.md5 === latest.md5) entry.urls.add(older.url);
		}
	}

	return new Map(Array.from(byMd5.values(), ({ file, urls }) => [file, Array.from(urls)]));
}
