import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FileGroup } from '../file/file_group.js';
import { FileRef } from '../file/file_ref.js';

console.log = vi.fn();

const { fsMock, cpMock, rclone } = vi.hoisted(() => ({
	fsMock: { writeFileSync: vi.fn(), mkdirSync: vi.fn() },
	cpMock: { execSync: vi.fn() },
	rclone: { uploadObject: vi.fn(), uploadDir: vi.fn() },
}));
vi.mock('fs', () => fsMock);
vi.mock('child_process', () => cpMock);
vi.mock('../mirror/rclone.js', () => rclone);

const { buildAndUploadSite } = await import('./site.js');

describe('buildAndUploadSite', () => {
	beforeEach(() => vi.clearAllMocks());

	function group(): FileGroup {
		const file = new FileRef('/home/download/osm/osm.versatiles', 2 ** 30, '/home/download/osm/osm.versatiles');
		file.hashes = { md5: 'abc', sha256: 'def' };
		return new FileGroup({
			slug: 'osm',
			title: 'OpenStreetMap',
			desc: 'd',
			order: 0,
			latestFile: file,
			olderFiles: [],
		});
	}

	it('writes the data file, builds, uploads objects then the build dir', () => {
		const count = buildAndUploadSite([group()], 'https://download.versatiles.org/');

		// 1. data file written
		const wrote = fsMock.writeFileSync.mock.calls[0];
		expect(String(wrote[0])).toMatch(/data\/fileGroups\.json$/);
		expect(String(wrote[1])).toContain('"slug":"osm"');

		// 2. vite build invoked
		expect(cpMock.execSync).toHaveBeenCalledWith(expect.stringContaining('vite build'), expect.anything());

		// 3. checksum/url-list objects uploaded (md5, sha256, urllist for the latest file)
		const urls = rclone.uploadObject.mock.calls.map((c) => c[0] as string);
		expect(urls).toContain('/osm.versatiles.md5');
		expect(urls).toContain('/osm.versatiles.sha256');
		expect(urls).toContain('/urllist_osm.tsv');
		expect(count).toBe(urls.length);

		// 4. build dir uploaded, and AFTER the objects (atomic publish ordering)
		expect(rclone.uploadDir).toHaveBeenCalledTimes(1);
		const lastObjectOrder = Math.max(...rclone.uploadObject.mock.invocationCallOrder);
		expect(rclone.uploadDir.mock.invocationCallOrder[0]).toBeGreaterThan(lastObjectOrder);
	});
});
