/**
 * Reads the `*.index.json` size indices in the browser to estimate how much a
 * `versatiles convert --bbox … --min-zoom … --max-zoom …` will download.
 *
 * The result is an approximation in both directions, which is why it is always
 * presented with a "~". It runs low because the index sums tile payloads only —
 * the container header, block/tile indices and the output format's own overhead
 * are not counted. It runs high because every quadtree leaf stores a *rounded*
 * mean, and that rounding accumulates over the many near-empty tiles of a sparse
 * level. Measured against `bathymetry-vectors`: 0.85x for a Berlin z0-8 extract
 * (278 KB estimated, 329 KB downloaded), 1.03x for the whole dataset.
 *
 * Deliberately no bbox padding: `versatiles convert --bbox-border` defaults to 0,
 * and the estimate must describe the command shown next to it. (The equivalent
 * estimator in versatiles-org/tools pads by 3 tiles because its own downloads do;
 * applying that here inflates low zoom levels enormously — a 3-tile border at z2
 * covers the whole planet, which measured 18x high.)
 */
import type { QuadNode, SizeIndex } from './types.js';

/** Geographic bounds as `[west, south, east, north]` in degrees. */
export type BBox = [number, number, number, number];

/** Tile column containing `lon` at zoom `z`. */
export function lon2tileX(lon: number, z: number): number {
	return Math.floor(((lon + 180) / 360) * (1 << z));
}

/** Tile row containing `lat` at zoom `z`. */
export function lat2tileY(lat: number, z: number): number {
	const latRad = (lat * Math.PI) / 180;
	return Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * (1 << z));
}

/**
 * Sums the estimated bytes of the tiles in the quadtree `node` that fall inside
 * the tile rectangle [`qxMin`, `qxMax`) x [`qyMin`, `qyMax`).
 *
 * `nodeX` / `nodeY` / `nodeSize` describe the square the node covers.
 */
export function estimateNode(
	node: QuadNode,
	nodeX: number,
	nodeY: number,
	nodeSize: number,
	qxMin: number,
	qyMin: number,
	qxMax: number,
	qyMax: number,
): number {
	// No overlap.
	if (nodeX >= qxMax || nodeX + nodeSize <= qxMin || nodeY >= qyMax || nodeY + nodeSize <= qyMin) {
		return 0;
	}

	if (typeof node === 'number') {
		const width = Math.min(nodeX + nodeSize, qxMax) - Math.max(nodeX, qxMin);
		const height = Math.min(nodeY + nodeSize, qyMax) - Math.max(nodeY, qyMin);
		return width * height * node;
	}

	const half = nodeSize / 2;
	return (
		estimateNode(node[0], nodeX, nodeY, half, qxMin, qyMin, qxMax, qyMax) +
		estimateNode(node[1], nodeX + half, nodeY, half, qxMin, qyMin, qxMax, qyMax) +
		estimateNode(node[2], nodeX, nodeY + half, half, qxMin, qyMin, qxMax, qyMax) +
		estimateNode(node[3], nodeX + half, nodeY + half, half, qxMin, qyMin, qxMax, qyMax)
	);
}

/**
 * Estimates the download size in bytes for the given area and zoom range.
 *
 * Omitting `bbox` estimates the full extent. Zoom bounds outside the index are
 * simply ignored, so passing a wider range than the container holds is safe.
 */
export function estimateDownloadSize(index: SizeIndex, bbox?: BBox, minZoom?: number, maxZoom?: number): number {
	let total = 0;

	for (const [zoomKey, root] of Object.entries(index.levels)) {
		const z = parseInt(zoomKey, 10);
		if (minZoom !== undefined && z < minZoom) continue;
		if (maxZoom !== undefined && z > maxZoom) continue;

		const gridSize = 1 << z;

		if (!bbox) {
			total += estimateNode(root, 0, 0, gridSize, 0, 0, gridSize, gridSize);
			continue;
		}

		const [west, south, east, north] = bbox;
		const txMin = Math.max(0, lon2tileX(west, z));
		const txMax = Math.min(gridSize - 1, lon2tileX(east, z));
		// Tile rows run north to south, so `north` yields the smaller row.
		const tyMin = Math.max(0, lat2tileY(north, z));
		const tyMax = Math.min(gridSize - 1, lat2tileY(south, z));

		total += estimateNode(root, 0, 0, gridSize, txMin, tyMin, txMax + 1, tyMax + 1);
	}

	return total;
}

/** The zoom levels present in an index, ascending. */
export function zoomLevels(index: SizeIndex): number[] {
	return Object.keys(index.levels)
		.map((key) => parseInt(key, 10))
		.sort((a, b) => a - b);
}

/** Indices already fetched, keyed by data-file url. `null` marks a known-absent index. */
const cache = new Map<string, SizeIndex | null>();

/**
 * Loads the size index belonging to a data file url (e.g. `/osm.versatiles`).
 *
 * Returns `null` when the dataset has no index — older versions are not indexed,
 * and a newly added dataset has none until the pipeline has built one — so
 * callers should treat the estimate as optional rather than failing.
 */
export async function loadSizeIndex(fileUrl: string): Promise<SizeIndex | null> {
	const cached = cache.get(fileUrl);
	if (cached !== undefined) return cached;

	let index: SizeIndex | null = null;
	try {
		const response = await fetch(`${fileUrl}.index.json`);
		if (response.ok) index = (await response.json()) as SizeIndex;
	} catch {
		index = null;
	}

	cache.set(fileUrl, index);
	return index;
}

/** Clears the in-memory index cache (used by tests). */
export function clearSizeIndexCache(): void {
	cache.clear();
}

const UNITS: [string, number][] = [
	['GB', 1024 ** 3],
	['MB', 1024 ** 2],
	['KB', 1024],
];

/** Formats a byte count with a unit and a sensible number of digits. */
export function formatBytes(bytes: number): string {
	const [unit, divisor] = UNITS.find(([, size]) => bytes >= size) ?? UNITS[UNITS.length - 1]!;
	const value = bytes / divisor;
	const digits = Math.max(0, 2 - Math.floor(Math.log10(Math.max(1, value))));
	return `${value.toFixed(digits)} ${unit}`;
}
