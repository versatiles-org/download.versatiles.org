import { describe, it, expect, beforeEach, vi } from 'vitest';

console.log = vi.fn();

const { rclone, builder } = vi.hoisted(() => ({
	rclone: { remoteMd5: vi.fn(), uploadObject: vi.fn() },
	builder: {
		// Typed parameters so `mock.calls[i][j]` is indexable in assertions below.
		buildSizeIndex: vi.fn(async (_source: string, _onProgress?: (completed: number, total: number) => void) => ({
			levels: { '0': 42 },
		})),
	},
}));
vi.mock('../mirror/rclone.js', () => rclone);
vi.mock('./build.js', () => builder);

const { FileGroup } = await import('../file/file_group.js');
const { FileRef } = await import('../file/file_ref.js');
const { syncSizeIndices, indexUrl } = await import('./sync.js');

const BASE = 'https://download.versatiles.org/';

/** Builds a remote FileRef with a given url and md5. */
function file(url: string, md5: string): InstanceType<typeof FileRef> {
	const remotePath = `/home/download${url}`;
	const ref = new FileRef(remotePath, 2 ** 30, remotePath);
	ref.url = url;
	ref.hashes = { md5, sha256: `sha-${md5}` };
	return ref;
}

/** Builds a group with the given latest file and optional older versions. */
function group(
	slug: string,
	latestFile: InstanceType<typeof FileRef>,
	olderFiles: InstanceType<typeof FileRef>[] = [],
): InstanceType<typeof FileGroup> {
	return new FileGroup({ slug, title: slug, desc: '', order: 0, latestFile, olderFiles });
}

/** Keys passed to uploadObject, in call order. */
function uploadedKeys(): string[] {
	return rclone.uploadObject.mock.calls.map((c) => c[0] as string);
}

describe('syncSizeIndices', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		rclone.remoteMd5.mockReturnValue(null);
	});

	it('builds and uploads an index with the source md5 as metadata', async () => {
		const stats = await syncSizeIndices([group('osm', file('/osm.versatiles', 'abc'))], BASE);

		expect(builder.buildSizeIndex).toHaveBeenCalledTimes(1);
		expect(builder.buildSizeIndex.mock.calls[0][0]).toBe('https://download.versatiles.org/osm.versatiles');

		expect(rclone.uploadObject).toHaveBeenCalledTimes(1);
		const [url, content, contentType, metadata] = rclone.uploadObject.mock.calls[0];
		expect(url).toBe('/osm.versatiles.index.json');
		expect(JSON.parse(content as string)).toEqual({ levels: { '0': 42 } });
		expect(contentType).toBe('application/json');
		expect(metadata).toEqual({ md5: 'abc' });

		expect(stats).toEqual({ built: 1, skipped: 0 });
	});

	it('skips when the stored md5 already matches', async () => {
		rclone.remoteMd5.mockReturnValue('abc');

		const stats = await syncSizeIndices([group('osm', file('/osm.versatiles', 'abc'))], BASE);

		expect(builder.buildSizeIndex).not.toHaveBeenCalled();
		expect(rclone.uploadObject).not.toHaveBeenCalled();
		expect(stats).toEqual({ built: 0, skipped: 1 });
	});

	it('rebuilds when the data changed under a stable key', async () => {
		// The index on R2 describes the previous release of the same key.
		rclone.remoteMd5.mockReturnValue('old-md5');

		const stats = await syncSizeIndices([group('osm', file('/osm.versatiles', 'new-md5'))], BASE);

		expect(builder.buildSizeIndex).toHaveBeenCalledTimes(1);
		expect(rclone.uploadObject.mock.calls[0][3]).toEqual({ md5: 'new-md5' });
		expect(stats).toEqual({ built: 1, skipped: 0 });
	});

	it('builds once for identical bytes published under a dated and a stable key', async () => {
		const stats = await syncSizeIndices(
			[group('osm', file('/osm.versatiles', 'abc'), [file('/osm.20260105.versatiles', 'abc')])],
			BASE,
		);

		expect(builder.buildSizeIndex).toHaveBeenCalledTimes(1);
		expect(uploadedKeys().sort()).toEqual(['/osm.20260105.versatiles.index.json', '/osm.versatiles.index.json']);
		expect(stats).toEqual({ built: 2, skipped: 0 });
	});

	it('does not index older versions with different content', async () => {
		const stats = await syncSizeIndices(
			[group('osm', file('/osm.versatiles', 'new'), [file('/osm.20240101.versatiles', 'ancient')])],
			BASE,
		);

		expect(builder.buildSizeIndex).toHaveBeenCalledTimes(1);
		expect(uploadedKeys()).toEqual(['/osm.versatiles.index.json']);
		expect(stats).toEqual({ built: 1, skipped: 0 });
	});

	it('uploads only the keys that are stale', async () => {
		// The dated index is current, the stable one is not.
		rclone.remoteMd5.mockImplementation((key: string) =>
			key === '/osm.20260105.versatiles.index.json' ? 'abc' : null,
		);

		const stats = await syncSizeIndices(
			[group('osm', file('/osm.versatiles', 'abc'), [file('/osm.20260105.versatiles', 'abc')])],
			BASE,
		);

		expect(uploadedKeys()).toEqual(['/osm.versatiles.index.json']);
		expect(stats).toEqual({ built: 1, skipped: 1 });
	});

	it('handles several groups and skips groups without a latest file', async () => {
		const stats = await syncSizeIndices(
			[
				group('osm', file('/osm.versatiles', 'a')),
				group('satellite', file('/satellite.versatiles', 'b')),
				new FileGroup({ slug: 'empty', title: 'empty', desc: '', order: 9 }),
			],
			BASE,
		);

		expect(uploadedKeys()).toEqual(['/osm.versatiles.index.json', '/satellite.versatiles.index.json']);
		expect(stats).toEqual({ built: 2, skipped: 0 });
	});
});

describe('indexUrl', () => {
	it('appends the sidecar suffix', () => {
		expect(indexUrl('/osm.versatiles')).toBe('/osm.versatiles.index.json');
	});
});
