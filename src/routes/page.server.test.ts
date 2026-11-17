import { describe, it, expect, vi } from 'vitest';
import type { FileGroupData, FileRefData } from '#lib/data.js';

const { data } = vi.hoisted(() => ({ data: { loadFileGroups: vi.fn() } }));
vi.mock('#lib/data.js', () => data);

// Not named `+page.server.test.ts`: SvelteKit reserves `+`-prefixed files in
// route directories and refuses to build when it finds one it does not recognise.
const { load } = await import('./+page.server.js');

function file(filename: string): FileRefData {
	return {
		fullname: `/home/osm-vector/${filename}`,
		filename,
		url: `/osm-vector/${filename}`,
		size: 1024,
		sizeString: '1 KB',
		remotePath: `/home/osm-vector/${filename}`,
		hashes: { md5: 'm', sha256: 's' },
	};
}

function group(): FileGroupData {
	return {
		slug: 'osm-vector',
		title: 'OSM',
		desc: ['desc'],
		order: 0,
		tileType: 'vector',
		latestFile: file('osm-vector.versatiles'),
		olderFiles: [file('osm-vector.20240101.versatiles')],
	};
}

/** Runs the loader. It reads no event fields, so the event is irrelevant. */
function run(): unknown {
	return load({} as Parameters<typeof load>[0]);
}

describe('load', () => {
	it('passes the fields the page renders', () => {
		data.loadFileGroups.mockReturnValue([group()]);

		expect(run()).toEqual({
			fileGroups: [
				{
					slug: 'osm-vector',
					title: 'OSM',
					desc: ['desc'],
					order: 0,
					tileType: 'vector',
					latestFile: {
						filename: 'osm-vector.versatiles',
						url: '/osm-vector/osm-vector.versatiles',
						sizeString: '1 KB',
					},
					olderFiles: [
						{
							filename: 'osm-vector.20240101.versatiles',
							url: '/osm-vector/osm-vector.20240101.versatiles',
							sizeString: '1 KB',
						},
					],
				},
			],
		});
	});

	it('keeps Storage Box paths out of the page, where search engines would crawl them', () => {
		data.loadFileGroups.mockReturnValue([group()]);

		expect(JSON.stringify(run())).not.toContain('/home/');
	});

	it('handles a group without a latest file', () => {
		data.loadFileGroups.mockReturnValue([{ ...group(), latestFile: undefined }]);

		expect(run()).toMatchObject({ fileGroups: [{ latestFile: undefined }] });
	});
});
