/**
 * Carries out the mirror plan, one dataset at a time.
 *
 * The order within a dataset is what keeps every public URL consistent with its
 * checksums and its size index while a release is rolled out:
 *
 * 1. upload the new files under their own keys, each followed at once by its
 *    `.md5` / `.sha256` objects;
 * 2. build the size index of the latest release from that key;
 * 3. only then replace the stable key (`/osm.versatiles`) by a copy within R2,
 *    followed at once by its checksum objects and a copy of the index.
 *
 * So the stable URL — the one the site and the tile server use — switches to a
 * new release when everything describing that release is ready, and the three
 * objects change within seconds of each other. The ~20 minute index build
 * happens beforehand, against the dated key nobody links to yet.
 *
 * A dataset that is published under an undated key only (`/satellite.versatiles`)
 * is overwritten in place by step 1. Its checksums still follow immediately;
 * its size index lags by the build time, because it can only be built from the
 * object once it is there.
 */
import type { FileGroup } from '../file/file_group.js';
import type { FileRef } from '../file/file_ref.js';
import { copySizeIndex, ensureSizeIndex } from '../size_index/sync.js';
import { releaseOf, type MirrorPlan, type StableCopy } from './plan.js';
import { copyDataFile, uploadDataFile, uploadObject } from './rclone.js';

/**
 * Executes `plan` and `copies` for the given groups (the grouped published
 * files the copies were planned from), and brings the size indices up to date.
 *
 * `baseURL` is the public base the size index builder reads the data through.
 *
 * Throws on the first transfer that fails; nothing after it is attempted.
 */
export async function executeMirror(
	groups: FileGroup[],
	plan: MirrorPlan,
	copies: StableCopy[],
	baseURL: string,
): Promise<void> {
	// Keyed by url: grouping clones files, so object identity is not preserved.
	const uploads = new Map<string, FileRef>();
	for (const action of plan.actions) {
		if (action.type === 'upload') uploads.set(action.file.url, action.file);
	}
	const copyTo = new Map(copies.map((copy) => [copy.to.url, copy]));

	for (const group of groups) {
		const latest = group.latestFile;
		const files = latest ? [...group.olderFiles, latest] : group.olderFiles;

		// 1. New files under their own keys.
		for (const file of files) {
			const upload = uploads.get(file.url);
			if (!upload) continue;
			uploadDataFile(upload);
			uploadChecksums(upload);
		}

		if (!latest) continue;

		// 2. The index of the latest release, read from the key it was uploaded to.
		const release = releaseOf(group) ?? latest;
		await ensureSizeIndex(release, baseURL);

		// 3. The stable key and everything that describes it.
		const copy = copyTo.get(latest.url);
		if (copy) {
			copyDataFile(copy.from, copy.to);
			uploadChecksums(copy.to);
		}
		if (release !== latest) copySizeIndex(release, latest);
	}
}

/** Uploads the `.md5` and `.sha256` objects of a data file. */
function uploadChecksums(file: FileRef): void {
	for (const response of [file.getResponseMd5File(), file.getResponseSha256File()]) {
		uploadObject(response.url, response.content, response.contentType);
	}
}
