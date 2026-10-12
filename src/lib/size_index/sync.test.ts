import { describe, it, expect, beforeEach, vi } from 'vitest';

console.log = vi.fn();

const { rclone, builder } = vi.hoisted(() => ({
	rclone: { remoteMd5: vi.fn(), uploadObject: vi.fn(), copyObject: vi.fn() },
	builder: {
		// Typed parameters so `mock.calls[i][j]` is indexable in assertions below.
		buildSizeIndex: vi.fn(async (_source: string, _onProgress?: (completed: number, total: number) => void) => ({
			levels: { '0': 42 },
		})),
	},
}));
vi.mock('../mirror/rclone.js', () => rclone);
vi.mock('./build.js', () => builder);

const { FileRef } = await import('../file/file_ref.js');
const { ensureSizeIndex, copySizeIndex, indexUrl } = await import('./sync.js');

const BASE = 'https://download.versatiles.org/';

/** Builds a remote FileRef with a given url and md5. */
function file(url: string, md5: string): InstanceType<typeof FileRef> {
	const remotePath = `/home/download${url}`;
	const ref = new FileRef(remotePath, 2 ** 30, remotePath);
	ref.url = url;
	ref.hashes = { md5, sha256: `sha-${md5}` };
	return ref;
}

describe('ensureSizeIndex', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		rclone.remoteMd5.mockReturnValue(null);
	});

	it('builds and uploads an index with the source md5 as metadata', async () => {
		const built = await ensureSizeIndex(file('/osm.20260105.versatiles', 'abc'), BASE);

		expect(built).toBe(true);
		expect(builder.buildSizeIndex).toHaveBeenCalledTimes(1);
		expect(builder.buildSizeIndex.mock.calls[0][0]).toBe('https://download.versatiles.org/osm.20260105.versatiles');

		expect(rclone.uploadObject).toHaveBeenCalledTimes(1);
		const [url, content, contentType, metadata] = rclone.uploadObject.mock.calls[0];
		expect(url).toBe('/osm.20260105.versatiles.index.json');
		expect(JSON.parse(content as string)).toEqual({ levels: { '0': 42 } });
		expect(contentType).toBe('application/json');
		expect(metadata).toEqual({ md5: 'abc' });
	});

	it('skips when the stored md5 already matches', async () => {
		rclone.remoteMd5.mockReturnValue('abc');

		const built = await ensureSizeIndex(file('/osm.versatiles', 'abc'), BASE);

		expect(built).toBe(false);
		expect(rclone.remoteMd5).toHaveBeenCalledWith('/osm.versatiles.index.json');
		expect(builder.buildSizeIndex).not.toHaveBeenCalled();
		expect(rclone.uploadObject).not.toHaveBeenCalled();
	});

	it('rebuilds when the data changed under a stable key', async () => {
		// The index on R2 describes the previous release of the same key.
		rclone.remoteMd5.mockReturnValue('old-md5');

		const built = await ensureSizeIndex(file('/satellite.versatiles', 'new-md5'), BASE);

		expect(built).toBe(true);
		expect(rclone.uploadObject.mock.calls[0][3]).toEqual({ md5: 'new-md5' });
	});

	it('uploads nothing when the build fails', async () => {
		builder.buildSizeIndex.mockRejectedValueOnce(new Error('range request failed'));

		await expect(ensureSizeIndex(file('/osm.versatiles', 'abc'), BASE)).rejects.toThrow('range request failed');
		expect(rclone.uploadObject).not.toHaveBeenCalled();
	});
});

describe('copySizeIndex', () => {
	const release = file('/osm.20260105.versatiles', 'abc');
	const stable = file('/osm.versatiles', 'abc');

	beforeEach(() => {
		vi.clearAllMocks();
		rclone.remoteMd5.mockReturnValue(null);
	});

	it('copies the index of a release to its stable key within R2, without building', () => {
		expect(copySizeIndex(release, stable)).toBe(true);

		expect(rclone.copyObject).toHaveBeenCalledWith('/osm.20260105.versatiles.index.json', '/osm.versatiles.index.json');
		expect(builder.buildSizeIndex).not.toHaveBeenCalled();
		expect(rclone.uploadObject).not.toHaveBeenCalled();
	});

	it('copies when the stable index describes an older release', () => {
		rclone.remoteMd5.mockReturnValue('previous');

		expect(copySizeIndex(release, stable)).toBe(true);
	});

	it('skips when the stable index is already current', () => {
		rclone.remoteMd5.mockReturnValue('abc');

		expect(copySizeIndex(release, stable)).toBe(false);
		expect(rclone.remoteMd5).toHaveBeenCalledWith('/osm.versatiles.index.json');
		expect(rclone.copyObject).not.toHaveBeenCalled();
	});
});

describe('indexUrl', () => {
	it('appends the sidecar suffix', () => {
		expect(indexUrl('/osm.versatiles')).toBe('/osm.versatiles.index.json');
	});
});
