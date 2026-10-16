import { basename } from 'path';
import type { FileGroup } from './file_group.js';
import type { FileRef } from './file_ref.js';
import { FileResponse } from './file_response.js';
import { indexUrl } from '../size_index/sync.js';

/** One downloadable file in `catalog.json`. All urls are absolute. */
export interface CatalogFile {
	url: string;
	size: number;
	md5: string;
	sha256: string;
	/** Release date (`YYYY-MM-DD`) from the file name, or null if it has none. */
	date: string | null;
}

/** One dataset in `catalog.json`. */
export interface CatalogDataset {
	slug: string;
	title: string;
	/** Description paragraphs; they may contain inline HTML such as links. */
	description: string[];
	tileType: 'raster' | 'vector';
	/** The current release under its stable url, with its size index. */
	latest: (CatalogFile & { index: string }) | null;
	/** Every release still listed, under its own url, newest first. */
	versions: CatalogFile[];
}

/**
 * Builds `/catalog.json`: a machine-readable list of every dataset and every
 * file the site advertises, with sizes and checksums.
 *
 * The content depends only on the files, so an unchanged catalog is uploaded
 * unchanged — it carries no build timestamp.
 */
export function buildCatalog(fileGroups: FileGroup[], baseURL: string): FileResponse {
	const abs = (url: string): string => new URL(url, baseURL).href;

	function entry(file: FileRef): CatalogFile {
		return { url: abs(file.url), size: file.size, md5: file.md5, sha256: file.sha256, date: dateOf(file) };
	}

	const datasets: CatalogDataset[] = fileGroups.map((group) => ({
		slug: group.slug,
		title: group.title,
		description: group.desc,
		tileType: group.tileType,
		latest: group.latestFile ? { ...entry(group.latestFile), index: abs(indexUrl(group.latestFile.url)) } : null,
		versions: group.olderFiles.map(entry),
	}));

	return new FileResponse('/catalog.json', JSON.stringify({ datasets }, null, '\t') + '\n', 'application/json');
}

/**
 * The release date in the file's original name on the Storage Box. That name
 * keeps the date even when the file is published under its stable, undated url.
 */
function dateOf(file: FileRef): string | null {
	const match = /\.(\d{4})(\d{2})(\d{2})\./.exec(basename(file.fullname));
	return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}
