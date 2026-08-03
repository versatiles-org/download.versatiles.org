/**
 * Builds a compact "size index" for a `.versatiles` container.
 *
 * The index answers "roughly how many bytes is this bbox at these zoom levels?"
 * without downloading any tiles. For every zoom level it stores a quadtree whose
 * leaves hold the *mean* tile size of the area they cover; the site uses it to
 * show a download estimate next to the generated `versatiles convert` command.
 *
 * Only the container's block index and tile indices are read (a few thousand
 * small HTTP range requests) — never the tile payloads themselves. A full build
 * still takes roughly 20 minutes for a planet-sized container, which is why the
 * result is cached on R2 and only rebuilt when the source data changes (see
 * `./sync.ts`).
 *
 * Ported from `scripts/build-size-index.ts` in versatiles-org/tools, which
 * produces the same JSON shape consumed by that project's size estimator.
 */
import { Container } from '@versatiles/container';
import type { Block, TileIndex } from '@versatiles/container';
import type { QuadNode, SizeIndex } from './types.js';

export type { QuadNode, SizeIndex } from './types.js';

/** Side length (in tiles) at which the quadtree stops subdividing. */
const MIN_NODE_SIZE = 16;

/** Collapse a node to a single mean when tile sizes vary less than this (stddev / mean). */
const CV_THRESHOLD = 0.5;

/** Concurrent tile-index fetches. */
const CONCURRENCY = 4;

/** Attempts per HTTP request before giving up. */
const MAX_ATTEMPTS = 5;

/** Delay before the first retry, doubled on each further attempt. */
const RETRY_DELAY = 2000;

/** Tiles per block edge, per the v02 container spec. */
const BLOCK_SIZE = 256;

/** Running aggregates over a set of tiles, used to decide whether to subdivide. */
interface Stats {
	tileCount: number;
	sum: number;
	sumOfSquares: number;
}

/**
 * A block paired with the tile byte lengths it contains.
 *
 * Exported so tests can drive {@link buildNode} with synthetic data: a real
 * container small enough to commit collapses to a single leaf, which never
 * exercises the recursive path.
 */
export interface BlockData {
	block: Block;
	lengths: Float64Array;
}

/** A built subtree together with the stats it was derived from. */
export interface BuildResult {
	node: QuadNode;
	stats: Stats;
}

/**
 * `Container` exposes `getBlockIndex` / `getTileIndex` as `protected`. They are
 * the only way to read tile sizes without fetching the tiles, so this subclass
 * widens them to public.
 */
class IndexedContainer extends Container {
	public override getBlockIndex(): Promise<Map<string, Block>> {
		return super.getBlockIndex();
	}

	public override getTileIndex(block: Block): Promise<TileIndex> {
		return super.getTileIndex(block);
	}
}

/**
 * Builds the size index for the container at `source` (an `http(s)://` URL or a
 * local path).
 *
 * `onProgress` is called with the number of blocks indexed so far and the total,
 * so callers can report progress on a build that runs for minutes.
 */
export async function buildSizeIndex(
	source: string,
	onProgress?: (completed: number, total: number) => void,
): Promise<SizeIndex> {
	const container = new IndexedContainer(source);

	try {
		const header = await withRetry('header', () => container.getHeader());
		const blockIndex = await withRetry('block index', () => container.getBlockIndex());

		// Group blocks by zoom level up front, so progress can be reported across
		// the whole build rather than per level.
		const blocksByZoom = new Map<number, Block[]>();
		let totalBlocks = 0;
		for (let z = header.zoomMin; z <= header.zoomMax; z++) {
			const blocks = Array.from(blockIndex.values()).filter((block) => block.level === z);
			blocksByZoom.set(z, blocks);
			totalBlocks += blocks.length;
		}

		let completedBlocks = 0;
		const levels: Record<string, QuadNode> = {};

		for (let z = header.zoomMin; z <= header.zoomMax; z++) {
			const blocks = blocksByZoom.get(z) ?? [];

			if (blocks.length === 0) {
				levels[z] = 0;
				continue;
			}

			const blockDataMap = await fetchAllTileIndices(container, blocks, () => {
				completedBlocks++;
				onProgress?.(completedBlocks, totalBlocks);
			});

			levels[z] = buildNode(blockDataMap, 0, 0, 1 << z).node;
		}

		return { levels };
	} finally {
		await container.close();
	}
}

/** Fetches the tile index of every block, at most `CONCURRENCY` requests at a time. */
async function fetchAllTileIndices(
	container: IndexedContainer,
	blocks: Block[],
	onProgress: () => void,
): Promise<Map<string, BlockData>> {
	const map = new Map<string, BlockData>();
	let next = 0;

	async function worker(): Promise<void> {
		for (;;) {
			const index = next++;
			const block = blocks[index];
			if (!block) return;

			const tileIndex = await withRetry(`tile index ${block.level}/${block.column}/${block.row}`, () =>
				container.getTileIndex(block),
			);
			map.set(`${block.column},${block.row}`, { block, lengths: tileIndex.lengths });
			onProgress();
		}
	}

	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, blocks.length) }, worker));

	return map;
}

/**
 * Builds the quadtree covering the square at (`xMin`, `yMin`) with edge `size`.
 *
 * A node collapses to a single mean when it is small enough, when it holds no
 * tiles, or when its tile sizes are uniform enough (coefficient of variation
 * below `CV_THRESHOLD`) that per-quadrant detail would not improve the estimate.
 */
export function buildNode(blockDataMap: Map<string, BlockData>, xMin: number, yMin: number, size: number): BuildResult {
	if (size <= MIN_NODE_SIZE) {
		const stats = collectStats(blockDataMap, xMin, yMin, size);
		// Mean over the whole square, not just the tiles present: absent tiles
		// contribute nothing to a download.
		const mean = stats.tileCount === 0 ? 0 : stats.sum / (size * size);
		return { node: Math.round(mean), stats };
	}

	const half = size / 2;
	const nw = buildNode(blockDataMap, xMin, yMin, half);
	const ne = buildNode(blockDataMap, xMin + half, yMin, half);
	const sw = buildNode(blockDataMap, xMin, yMin + half, half);
	const se = buildNode(blockDataMap, xMin + half, yMin + half, half);

	const stats: Stats = {
		tileCount: nw.stats.tileCount + ne.stats.tileCount + sw.stats.tileCount + se.stats.tileCount,
		sum: nw.stats.sum + ne.stats.sum + sw.stats.sum + se.stats.sum,
		sumOfSquares: nw.stats.sumOfSquares + ne.stats.sumOfSquares + sw.stats.sumOfSquares + se.stats.sumOfSquares,
	};

	if (stats.tileCount === 0) return { node: 0, stats };

	const mean = stats.sum / stats.tileCount;
	const variance = stats.sumOfSquares / stats.tileCount - mean * mean;
	const cv = mean > 0 ? Math.sqrt(Math.max(0, variance)) / mean : 0;

	if (cv < CV_THRESHOLD) {
		return { node: Math.round(stats.sum / (size * size)), stats };
	}

	// Four identical leaves carry no more information than one.
	if (typeof nw.node === 'number' && nw.node === ne.node && nw.node === sw.node && nw.node === se.node) {
		return { node: nw.node, stats };
	}

	return { node: [nw.node, ne.node, sw.node, se.node], stats };
}

/** Aggregates tile count and byte sizes over the tile square at (`xMin`, `yMin`) with edge `size`. */
function collectStats(blockDataMap: Map<string, BlockData>, xMin: number, yMin: number, size: number): Stats {
	const xMax = xMin + size;
	const yMax = yMin + size;

	const stats: Stats = { tileCount: 0, sum: 0, sumOfSquares: 0 };

	// Blocks hold BLOCK_SIZE² tiles, so the square touches this block range.
	for (let bx = Math.floor(xMin / BLOCK_SIZE); bx <= Math.floor((xMax - 1) / BLOCK_SIZE); bx++) {
		for (let by = Math.floor(yMin / BLOCK_SIZE); by <= Math.floor((yMax - 1) / BLOCK_SIZE); by++) {
			const data = blockDataMap.get(`${bx},${by}`);
			if (!data) continue;

			const { block, lengths } = data;

			// Intersect the requested square with the tiles this block actually stores.
			const tileXMin = Math.max(xMin - bx * BLOCK_SIZE, block.colMin);
			const tileXMax = Math.min(xMax - 1 - bx * BLOCK_SIZE, block.colMax);
			const tileYMin = Math.max(yMin - by * BLOCK_SIZE, block.rowMin);
			const tileYMax = Math.min(yMax - 1 - by * BLOCK_SIZE, block.rowMax);

			if (tileXMin > tileXMax || tileYMin > tileYMax) continue;

			const cols = block.colMax - block.colMin + 1;

			for (let ty = tileYMin; ty <= tileYMax; ty++) {
				for (let tx = tileXMin; tx <= tileXMax; tx++) {
					const length = lengths[(ty - block.rowMin) * cols + (tx - block.colMin)] ?? 0;
					// A length of 0 means the tile is not stored.
					if (length > 0) {
						stats.tileCount++;
						stats.sum += length;
						stats.sumOfSquares += length * length;
					}
				}
			}
		}
	}

	return stats;
}

/**
 * Retries a failed request with exponential backoff.
 *
 * A full build issues tens of thousands of HTTP range requests, so an occasional
 * stalled or reset connection is normal. Without retries a single such stall
 * discards the whole ~20 minute build.
 */
async function withRetry<T>(what: string, fn: () => Promise<T>): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await fn();
		} catch (error) {
			if (attempt >= MAX_ATTEMPTS) throw error;
			const delay = RETRY_DELAY * 2 ** (attempt - 1);
			const message = error instanceof Error ? error.message : String(error);
			console.log(`   ${what} failed (attempt ${attempt}/${MAX_ATTEMPTS}): ${message} — retrying in ${delay / 1000}s`);
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}
}
