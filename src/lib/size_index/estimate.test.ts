import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SizeIndex } from './types.js';
import {
	clearSizeIndexCache,
	estimateDownloadSize,
	estimateNode,
	formatBytes,
	lat2tileY,
	loadSizeIndex,
	lon2tileX,
	zoomLevels,
} from './estimate.js';

describe('tile coordinates', () => {
	it('maps the antimeridian and prime meridian', () => {
		expect(lon2tileX(-180, 2)).toBe(0);
		expect(lon2tileX(0, 2)).toBe(2);
		expect(lon2tileX(179.9, 2)).toBe(3);
	});

	it('maps latitude north to south', () => {
		expect(lat2tileY(85, 2)).toBe(0);
		expect(lat2tileY(0, 2)).toBe(2);
		expect(lat2tileY(-85, 2)).toBe(3);
	});

	it('places Berlin in the expected z11 tile', () => {
		expect(lon2tileX(13.4, 11)).toBe(1100);
		expect(lat2tileY(52.5, 11)).toBe(671);
	});
});

describe('estimateNode', () => {
	it('multiplies a leaf mean by the overlapping tile count', () => {
		// A 4x4 node of 100-byte tiles, fully covered.
		expect(estimateNode(100, 0, 0, 4, 0, 0, 4, 4)).toBe(1600);
		// Only a 2x2 corner overlaps.
		expect(estimateNode(100, 0, 0, 4, 0, 0, 2, 2)).toBe(400);
	});

	it('returns zero when the query misses the node', () => {
		expect(estimateNode(100, 0, 0, 4, 8, 8, 12, 12)).toBe(0);
	});

	it('recurses into children in NW, NE, SW, SE order', () => {
		const node: [number, number, number, number] = [1, 2, 3, 4];
		// Each child covers one tile of a 2x2 grid.
		expect(estimateNode(node, 0, 0, 2, 0, 0, 1, 1)).toBe(1); // NW
		expect(estimateNode(node, 0, 0, 2, 1, 0, 2, 1)).toBe(2); // NE
		expect(estimateNode(node, 0, 0, 2, 0, 1, 1, 2)).toBe(3); // SW
		expect(estimateNode(node, 0, 0, 2, 1, 1, 2, 2)).toBe(4); // SE
		expect(estimateNode(node, 0, 0, 2, 0, 0, 2, 2)).toBe(10); // all
	});
});

describe('estimateDownloadSize', () => {
	/** Every tile is 100 bytes at each of z0..z2. */
	const index: SizeIndex = { levels: { '0': 100, '1': 100, '2': 100 } };

	it('sums the full extent of every level when no bbox is given', () => {
		// z0 = 1 tile, z1 = 4, z2 = 16 -> 21 tiles.
		expect(estimateDownloadSize(index)).toBe(2100);
	});

	it('honours the zoom range', () => {
		expect(estimateDownloadSize(index, undefined, 0, 0)).toBe(100);
		expect(estimateDownloadSize(index, undefined, 2, 2)).toBe(1600);
		expect(estimateDownloadSize(index, undefined, 1, 2)).toBe(2000);
	});

	it('ignores zoom bounds outside the index', () => {
		expect(estimateDownloadSize(index, undefined, 0, 14)).toBe(2100);
	});

	it('restricts to a bbox', () => {
		// The north-west quadrant of the world at z1 is a single tile.
		expect(estimateDownloadSize(index, [-180, 0.1, -0.1, 85], 1, 1)).toBe(100);
	});

	it('does not pad the bbox, matching --bbox-border=0', () => {
		// A tiny bbox inside one z2 tile must cost exactly one tile. Padding by
		// even a single tile would triple this.
		expect(estimateDownloadSize(index, [-179, 80, -178, 81], 2, 2)).toBe(100);
	});

	it('clamps to the grid at the edges of the world', () => {
		expect(estimateDownloadSize(index, [-180, -85, 180, 85], 1, 1)).toBe(400);
	});
});

describe('zoomLevels', () => {
	it('returns numeric levels in ascending order', () => {
		expect(zoomLevels({ levels: { '10': 0, '2': 0, '1': 0 } })).toEqual([1, 2, 10]);
	});
});

describe('formatBytes', () => {
	it('picks a unit and scales the precision', () => {
		expect(formatBytes(2.9 * 1024 ** 2)).toBe('2.90 MB');
		expect(formatBytes(66.5 * 1024 ** 3)).toBe('66.5 GB');
		expect(formatBytes(329 * 1024)).toBe('329 KB');
	});

	it('falls back to KB below a kilobyte', () => {
		expect(formatBytes(0)).toBe('0.00 KB');
	});
});

describe('loadSizeIndex', () => {
	beforeEach(() => {
		clearSizeIndexCache();
		vi.unstubAllGlobals();
	});

	it('fetches the sidecar next to the data file', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ levels: { '0': 5 } })));
		vi.stubGlobal('fetch', fetchMock);

		const index = await loadSizeIndex('/osm.versatiles');

		expect(fetchMock).toHaveBeenCalledWith('/osm.versatiles.index.json');
		expect(index).toEqual({ levels: { '0': 5 } });
	});

	it('returns null for datasets without an index', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('Not Found', { status: 404 })),
		);
		expect(await loadSizeIndex('/osm.20240101.versatiles')).toBeNull();
	});

	it('returns null when the request fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('offline');
			}),
		);
		expect(await loadSizeIndex('/osm.versatiles')).toBeNull();
	});

	it('caches hits and misses so reopening the dialog costs nothing', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ levels: { '0': 5 } })));
		vi.stubGlobal('fetch', fetchMock);

		await loadSizeIndex('/osm.versatiles');
		await loadSizeIndex('/osm.versatiles');
		expect(fetchMock).toHaveBeenCalledTimes(1);

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('Not Found', { status: 404 })),
		);
		await loadSizeIndex('/missing.versatiles');
		await loadSizeIndex('/missing.versatiles');
		expect(await loadSizeIndex('/missing.versatiles')).toBeNull();
	});
});
