import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FileGroup } from '../file/file_group.js';
import { FileRef } from '../file/file_ref.js';

console.log = vi.fn();

const { fsMock, cpMock, rclone } = vi.hoisted(() => ({
	fsMock: {
		writeFileSync: vi.fn(),
		mkdirSync: vi.fn(),
		existsSync: vi.fn(() => true),
		readFileSync: vi.fn(() => '<rss></rss>'),
	},
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

	it('writes data, builds, uploads sidecars then build dir, and fixes the feed mime', () => {
		const count = buildAndUploadSite([group()], 'https://download.versatiles.org/');

		// 1. data file written
		expect(String(fsMock.writeFileSync.mock.calls[0][0])).toMatch(/data\/fileGroups\.json$/);
		expect(String(fsMock.writeFileSync.mock.calls[0][1])).toContain('"slug":"osm"');

		// 2. vite build invoked
		expect(cpMock.execSync).toHaveBeenCalledWith(expect.stringContaining('vite build'), expect.anything());

		// index the uploadObject calls by url
		const calls = rclone.uploadObject.mock.calls as [string, string, string][];
		const byUrl = Object.fromEntries(calls.map((c) => [c[0], c]));
		expect(byUrl['/osm.versatiles.md5']).toBeDefined();
		expect(byUrl['/osm.versatiles.sha256']).toBeDefined();
		expect(byUrl['/urllist_osm.tsv']).toBeDefined();
		expect(count).toBe(3); // sidecars + url list (feeds not counted)

		// 3. feed re-uploaded with the RSS content type
		expect(byUrl['/feed-osm.xml']).toBeDefined();
		expect(byUrl['/feed-osm.xml'][2]).toBe('application/rss+xml');

		// 4. ordering: sidecars → build dir → feed mime fix
		const orderOf = (url: string) => rclone.uploadObject.mock.invocationCallOrder[calls.findIndex((c) => c[0] === url)];
		const sidecarMax = Math.max(
			orderOf('/osm.versatiles.md5'),
			orderOf('/osm.versatiles.sha256'),
			orderOf('/urllist_osm.tsv'),
		);
		const dirOrder = rclone.uploadDir.mock.invocationCallOrder[0];
		expect(sidecarMax).toBeLessThan(dirOrder);
		expect(dirOrder).toBeLessThan(orderOf('/feed-osm.xml'));
	});
});
