/**
 * Builds the `versatiles convert` command that the download dialog shows.
 *
 * Kept out of the Svelte component so it can be tested directly: this string is
 * the dialog's actual output — users copy and run it — and every option in the
 * dialog exists only to change it.
 */
import type { BBox } from './size_index/estimate.js';

/** How the user intends to run VersaTiles. */
export type Tool = 'versatiles' | 'docker';

/** Container format the command writes. */
export type Format = 'versatiles' | 'pmtiles' | 'mbtiles' | 'tar';

export interface CommandOptions {
	tool: Tool;
	/** Absolute url of the source container. */
	source: string;
	/** Output file name, e.g. `osm.pmtiles`. */
	output: string;
	/** Restrict to an area; omitted for the whole world. */
	bbox?: BBox;
	/** Lowest zoom level to include. */
	minZoom?: number;
	/** Highest zoom level to include. */
	maxZoom?: number;
	/** Highest level the container holds; `maxZoom` at or above it is not a limit. */
	zoomCeiling?: number;
}

/** Docker needs the working directory mounted, and writes inside that mount. */
const DOCKER_PREFIX = ['docker run -it --rm -v $(pwd):/data', 'versatiles/versatiles:latest convert'];

/**
 * Assembles the command, emitting only the flags that actually narrow the
 * download so an untouched dialog still shows the plain whole-file command.
 */
export function buildCommand({
	tool,
	source,
	output,
	bbox,
	minZoom = 0,
	maxZoom,
	zoomCeiling,
}: CommandOptions): string {
	const parts: string[] = tool === 'docker' ? [...DOCKER_PREFIX] : ['versatiles convert'];

	if (bbox) parts.push(`--bbox ${bbox.join(',')}`);
	if (minZoom > 0) parts.push(`--min-zoom ${minZoom}`);
	if (maxZoom !== undefined && zoomCeiling !== undefined && maxZoom < zoomCeiling) {
		parts.push(`--max-zoom ${maxZoom}`);
	}

	parts.push(`"${source}"`, `"${tool === 'docker' ? '/data/' : ''}${output}"`);

	return parts.join(' \\\n  ');
}
