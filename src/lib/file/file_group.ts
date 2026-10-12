import { datasetOf, slugOf } from './datasets.js';
import { FileRef } from './file_ref.js';
import { FileResponse } from './file_response.js';

/**
 * Represents a logical group of related files (typically different versions of
 * the same dataset) in the download.versatiles.org catalog.
 *
 * A group is identified by its `slug` (derived from the file name) and may
 * contain multiple `FileRef` instances:
 *
 * - `latestFile`: the most recent file that should be advertised and used by default
 * - `olderFiles`: additional versions that remain available for download
 *
 * The high-level workflow is:
 * - `groupFiles()` discovers all `FileRef`s and assigns them to `FileGroup`s
 *   based on the slug (usually the basename without extension).
 * - For each group, `latestFile` is determined from the file names and may
 *   have its `url` normalised (e.g. date suffix removed).
 * - The remaining entries are kept in `olderFiles` and exposed as "previous versions".
 */
export class FileGroup {
	/** Machine-readable identifier of the group (derived from the file basename). */
	slug: string;

	/** Human-readable title shown in the download listing. */
	title: string;

	/**
	 * Description paragraphs, including attribution and licence information.
	 *
	 * Kept as separate lines rather than one pre-joined string so each consumer
	 * can use its own separator: the page joins them with `<br>`, the RSS feed
	 * with a newline. Joining with `<br>` here once made the feeds invalid XML,
	 * which has no void elements.
	 *
	 * The individual lines may still contain inline HTML such as links.
	 */
	desc: string[];

	/**
	 * Sort order of the group in the UI.
	 * Lower values appear first in the listing.
	 */
	order: number;

	/**
	 * The type of tiles contained in this group's files.
	 * - `'vector'`: Protocol Buffer encoded vector tiles (e.g. MVT/PBF)
	 * - `'raster'`: Image-based raster tiles (e.g. PNG, JPEG, WebP)
	 */
	tileType: 'raster' | 'vector';

	/**
	 * The current default file for this group.
	 * Set by `groupFiles()` based on the most recent file name.
	 */
	latestFile?: FileRef;

	/**
	 * All available versions for this group, sorted from newest to oldest.
	 * The first entry is cloned and promoted to `latestFile` during grouping.
	 */
	olderFiles: FileRef[];
	constructor(options: {
		slug: string;
		title: string;
		desc: string[];
		order: number;
		tileType?: 'raster' | 'vector';
		latestFile?: FileRef;
		olderFiles?: FileRef[];
	}) {
		this.slug = options.slug;
		this.title = options.title;
		this.desc = options.desc;
		this.order = options.order;
		this.tileType = options.tileType ?? 'vector';
		this.latestFile = options.latestFile;
		this.olderFiles = options.olderFiles ?? [];
	}
	/**
	 * Builds a `FileResponse` representing a TSV url list for the latest file
	 * in this group. The format follows the "TsvHttpData-1.0" specification:
	 *
	 *   TsvHttpData-1.0
	 *   <url>\t<size>\t<base64(md5)>\n
	 *
	 * The `baseURL` parameter is used to turn the file's relative `url` into
	 * an absolute URL.
	 *
	 * Throws if no `latestFile` has been assigned to this group.
	 */
	getResponseUrlList(baseURL: string): FileResponse {
		const file = this.latestFile;
		if (file == null) throw Error(`no latest file found in group "${this.slug}"`);
		const url = new URL(file.url, baseURL).href;

		return new FileResponse(
			`/urllist_${this.slug}.tsv`,
			`TsvHttpData-1.0\n${url}\t${file.size}\t${hex2base64(file.md5)}\n`,
		);
	}
	/**
	 * Returns all virtual responses associated with this group:
	 *
	 * - `.md5` and `.sha256` checksum files for all versions
	 * - a TSV url list (`/urllist_<slug>.tsv`) for the latest version
	 */
	getResponses(baseURL: string): FileResponse[] {
		const result: FileResponse[] = this.olderFiles.flatMap((f) => [f.getResponseMd5File(), f.getResponseSha256File()]);
		if (this.latestFile) {
			result.push(
				this.latestFile.getResponseMd5File(),
				this.latestFile.getResponseSha256File(),
				this.getResponseUrlList(baseURL),
			);
		}
		return result;
	}
}

/**
 * Groups a flat list of `FileRef`s into logical `FileGroup`s.
 *
 * - The group `slug` is the file name up to its first dot.
 * - Title, description, ordering and `tileType` of each group come from
 *   the dataset table in `./datasets.ts`.
 * - A file of a dataset that is not in that table is an error: it must not be
 *   published under a placeholder title.
 *
 * Within each group:
 * - Files are sorted by `filename` descending (newest first).
 * - The first entry is cloned into `latestFile`.
 * - If the filename contains a date in the form `.YYYYMMDD.`, it is removed
 *   from the `latestFile.url` to provide a stable, version-agnostic URL.
 *   Otherwise, the original URL is kept and the file is removed from
 *   `olderFiles` (so it only appears as `latestFile`).
 *
 * The resulting list is sorted by `order` for display.
 */
export function groupFiles(files: FileRef[]): FileGroup[] {
	const groupMap = new Map<string, FileGroup>();
	files.forEach((file) => {
		const slug = slugOf(file.filename);
		let group = groupMap.get(slug);

		if (!group) {
			const dataset = datasetOf(slug);
			if (!dataset) throw new Error(`"${file.filename}" belongs to no known dataset ("${slug}")`);

			group = new FileGroup({ slug, ...dataset });
			groupMap.set(slug, group);
		}

		group.olderFiles.push(file);
	});

	const groupList = Array.from(groupMap.values());

	groupList.sort((a, b) => a.order - b.order);

	groupList.forEach((group) => {
		group.olderFiles.sort((a, b) => (a.filename < b.filename ? 1 : -1));
		group.latestFile = group.olderFiles[0].clone();
		const newUrl = group.latestFile.url.replace(/\.\d{8}\./, '.');
		if (newUrl === group.latestFile.url) {
			group.olderFiles.shift();
		} else {
			group.latestFile.url = newUrl;
			group.latestFile.filename = newUrl.replace(/^\/+/, '');
		}
	});

	return groupList;
}

/**
 * Converts a hexadecimal hash string into a standard base64-encoded string.
 *
 * Used for the TsvHttpData-1.0 format, which expects standard base64.
 */
export function hex2base64(hex: string): string {
	return Buffer.from(hex, 'hex').toString('base64');
}
