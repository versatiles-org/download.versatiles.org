import { describe, it, expect } from 'vitest';
import { statSync } from 'node:fs';
import { buildNode, buildSizeIndex, type BlockData } from './build.js';
import { estimateDownloadSize } from './estimate.js';

/**
 * A whole-world z0 extract of `bathymetry-vectors`, 39 KB.
 *
 * Deliberately a *global* extract rather than a bbox one: an index built from a
 * bbox extract spreads its mean over the whole grid, so the totals it reports
 * are meaningless outside the extracted area.
 */
const FIXTURE = 'src/lib/size_index/fixtures/tiny.versatiles';

/** Builds a block of `size`×`size` tiles, each `length` bytes. */
function uniformBlock(size: number, length: number): Map<string, BlockData> {
	return blockOf(size, () => length);
}

/** Builds a block whose tile lengths come from `lengthAt(x, y)`. */
function blockOf(size: number, lengthAt: (x: number, y: number) => number): Map<string, BlockData> {
	const lengths = new Float64Array(size * size);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) lengths[y * size + x] = lengthAt(x, y);
	}
	return new Map([
		[
			'0,0',
			{
				block: {
					level: 0,
					column: 0,
					row: 0,
					colMin: 0,
					rowMin: 0,
					colMax: size - 1,
					rowMax: size - 1,
					blockOffset: 0,
					tileIndexOffset: 0,
					tileIndexLength: 0,
					tileCount: size * size,
				},
				lengths,
			},
		],
	]);
}

describe('buildSizeIndex', () => {
	it('reads a real container and reports a total close to its file size', async () => {
		const index = await buildSizeIndex(FIXTURE);

		expect(Object.keys(index.levels)).toEqual(['0']);

		// Tile payloads only, so the total sits just under the container size.
		const fileSize = statSync(FIXTURE).size;
		const total = estimateDownloadSize(index);
		expect(total).toBeLessThan(fileSize);
		expect(total / fileSize).toBeGreaterThan(0.95);
	});

	it('reports progress across the whole build', async () => {
		const seen: [number, number][] = [];
		await buildSizeIndex(FIXTURE, (completed, total) => seen.push([completed, total]));

		expect(seen.length).toBeGreaterThan(0);
		const [lastCompleted, lastTotal] = seen[seen.length - 1]!;
		expect(lastCompleted).toBe(lastTotal);
	});

	it('rejects a container that does not exist', async () => {
		await expect(buildSizeIndex('src/lib/size_index/fixtures/missing.versatiles')).rejects.toThrow();
	});
});

describe('buildNode', () => {
	it('collapses an area with no tiles to zero', () => {
		expect(buildNode(new Map(), 0, 0, 64).node).toBe(0);
	});

	it('averages a small area into a single leaf', () => {
		// 8 <= MIN_NODE_SIZE, so this is a leaf regardless of variance.
		expect(buildNode(uniformBlock(8, 100), 0, 0, 8).node).toBe(100);
	});

	it('divides by the full area, not just the tiles present', () => {
		// Half the 8x8 square is empty, so the mean per tile is halved.
		const data = blockOf(8, (_x, y) => (y < 4 ? 100 : 0));
		expect(buildNode(data, 0, 0, 8).node).toBe(50);
	});

	it('collapses a large uniform area rather than subdividing it', () => {
		// Uniform sizes mean the coefficient of variation is 0, so per-quadrant
		// detail would add nothing.
		expect(buildNode(uniformBlock(64, 100), 0, 0, 64).node).toBe(100);
	});

	it('subdivides when tile sizes vary widely', () => {
		// One quadrant far heavier than the rest pushes the CV over the threshold.
		const data = blockOf(64, (x, y) => (x < 32 && y < 32 ? 10000 : 1));
		const node = buildNode(data, 0, 0, 64).node;

		expect(Array.isArray(node)).toBe(true);
		const [nw, ne, sw, se] = node as [number, number, number, number];
		expect(nw).toBeGreaterThan(ne);
		expect(nw).toBeGreaterThan(sw);
		expect(nw).toBeGreaterThan(se);
	});

	it('produces a tree the estimator can traverse back to the same total', () => {
		const data = blockOf(64, (x, y) => (x < 32 && y < 32 ? 10000 : 1));
		const { node } = buildNode(data, 0, 0, 64);

		// Every tile is 10000 or 1: 32*32 heavy + the rest light.
		const expected = 32 * 32 * 10000 + (64 * 64 - 32 * 32) * 1;
		expect(estimateDownloadSize({ levels: { '6': node } })).toBeCloseTo(expected, -3);
	});
});
