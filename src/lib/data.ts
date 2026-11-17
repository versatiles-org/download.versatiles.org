/**
 * Data loading utilities for the SvelteKit routes.
 *
 * Reads the pre-generated `data/fileGroups.json` that the pipeline writes before
 * `vite build`. The structures are plain-object versions of the `FileGroup` /
 * `FileRef` classes used by the pipeline.
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/** Plain-object version of FileRef (as serialised to JSON). */
export interface FileRefData {
	fullname: string;
	filename: string;
	url: string;
	size: number;
	sizeString: string;
	remotePath: string;
	hashes: { md5: string; sha256: string };
}

/** Plain-object version of FileGroup (as serialised to JSON). */
export interface FileGroupData {
	slug: string;
	title: string;
	/** Description paragraphs; each consumer joins them with its own separator. */
	desc: string[];
	order: number;
	tileType: 'raster' | 'vector';
	latestFile?: FileRefData;
	olderFiles: FileRefData[];
}

/**
 * The fields of a file that the download page renders.
 *
 * Whatever the page's `load` returns is serialised into the prerendered HTML for
 * hydration, and search engines crawl URL-like strings found there. So the
 * Storage Box paths (`fullname`, `remotePath`) must not reach it: Google turned
 * them into 404s like `/home/osm-vector/osm-vector.versatiles`.
 */
export type PageFileData = Pick<FileRefData, 'filename' | 'url' | 'sizeString'>;

/** A file group as the download page receives it. */
export interface PageGroupData extends Omit<FileGroupData, 'latestFile' | 'olderFiles'> {
	latestFile?: PageFileData;
	olderFiles: PageFileData[];
}

/**
 * Loads the file groups from the JSON data file written by the pipeline.
 * Returns an empty array when the file does not exist (e.g. during `vite dev`
 * before `generate_testdata`).
 */
export function loadFileGroups(): FileGroupData[] {
	const dataPath = resolve('data/fileGroups.json');
	if (!existsSync(dataPath)) return [];
	return JSON.parse(readFileSync(dataPath, 'utf-8')) as FileGroupData[];
}
