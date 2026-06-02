import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FileGroup } from '../file/file_group.js';
import { FileRef } from '../file/file_ref.js';

console.log = vi.fn();

const rclone = { uploadObject: vi.fn() };
vi.mock('../mirror/rclone.js', () => rclone);

const { buildAndUploadSite } = await import('./site.js');

describe('buildAndUploadSite', () => {
	beforeEach(() => vi.clearAllMocks());

	it('uploads index.html, one RSS feed per group, and each group response', () => {
		const file = new FileRef('/home/osm/osm.versatiles', 2 ** 30, '/home/osm/osm.versatiles');
		file.hashes = { md5: 'abc', sha256: 'def' };
		const group = new FileGroup({
			slug: 'osm',
			title: 'OpenStreetMap',
			desc: 'desc',
			order: 0,
			latestFile: file,
			olderFiles: [],
		});

		const count = buildAndUploadSite([group], 'https://download.versatiles.org/');

		const urls = rclone.uploadObject.mock.calls.map(c => c[0] as string);
		// index.html + feed-osm.xml + (md5, sha256, urllist) for the latest file
		expect(urls).toContain('/index.html');
		expect(urls).toContain('/feed-osm.xml');
		expect(urls).toContain('/osm.versatiles.md5');
		expect(urls).toContain('/osm.versatiles.sha256');
		expect(urls).toContain('/urllist_osm.tsv');
		expect(count).toBe(urls.length);

		// Content types are forwarded.
		const html = rclone.uploadObject.mock.calls.find(c => c[0] === '/index.html')!;
		expect(html[2]).toBe('text/html');
	});
});
