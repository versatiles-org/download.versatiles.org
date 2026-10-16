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
			desc: ['d'],
			order: 0,
			latestFile: file,
			olderFiles: [],
		});
	}

	/** Everything sent to R2, in order: object urls and `dir:<prefix>` for directory uploads. */
	function uploads(): string[] {
		const objects = rclone.uploadObject.mock.calls.map((call, i) => ({
			at: rclone.uploadObject.mock.invocationCallOrder[i],
			what: call[0] as string,
		}));
		const dirs = rclone.uploadDir.mock.calls.map((call, i) => ({
			at: rclone.uploadDir.mock.invocationCallOrder[i],
			what: `dir:${(call[1] as string | undefined) ?? ''}`,
		}));
		return [...objects, ...dirs].sort((a, b) => a.at - b.at).map((entry) => entry.what);
	}

	it('writes the data file and builds the site', () => {
		buildAndUploadSite([group()], 'https://download.versatiles.org/');

		expect(String(fsMock.writeFileSync.mock.calls[0][0])).toMatch(/data\/fileGroups\.json$/);
		expect(String(fsMock.writeFileSync.mock.calls[0][1])).toContain('"slug":"osm"');
		expect(cpMock.execSync).toHaveBeenCalledWith(expect.stringContaining('vite build'), expect.anything());
	});

	it('uploads the pages last, after everything they refer to', () => {
		const count = buildAndUploadSite([group()], 'https://download.versatiles.org/');

		expect(uploads()).toEqual([
			'/osm.versatiles.md5',
			'/osm.versatiles.sha256',
			'/urllist_osm.tsv',
			'/catalog.json',
			'dir:_app',
			'/feed-osm.xml',
			'dir:',
		]);
		expect(count).toBe(4); // sidecars + url list + catalog (feeds not counted)
	});

	it('uploads the assets from the _app folder of the build to the same prefix', () => {
		buildAndUploadSite([group()], 'https://download.versatiles.org/');

		const [dir, prefix] = rclone.uploadDir.mock.calls[0];
		expect(String(dir)).toMatch(/build\/_app$/);
		expect(prefix).toBe('_app');
	});

	it('uploads each feed once, with the RSS content type', () => {
		buildAndUploadSite([group()], 'https://download.versatiles.org/');

		const feeds = rclone.uploadObject.mock.calls.filter((call) => call[0] === '/feed-osm.xml');
		expect(feeds).toHaveLength(1);
		expect(feeds[0][2]).toBe('application/rss+xml');

		// …and keeps them, and the assets, out of the final directory upload.
		const [dir, prefix, exclude] = rclone.uploadDir.mock.calls[1];
		expect(String(dir)).toMatch(/build$/);
		expect(prefix).toBe('');
		expect(exclude).toEqual(['/_app/**', '/feed-*.xml']);
	});

	it('copes with a build that has no assets folder or feed', () => {
		fsMock.existsSync.mockReturnValue(false);

		buildAndUploadSite([group()], 'https://download.versatiles.org/');

		expect(uploads()).toEqual([
			'/osm.versatiles.md5',
			'/osm.versatiles.sha256',
			'/urllist_osm.tsv',
			'/catalog.json',
			'dir:',
		]);
		fsMock.existsSync.mockReturnValue(true);
	});
});
