import { describe, it, expect } from 'vitest';
import { buildCatalog } from './catalog.js';
import { groupFiles } from './file_group.js';
import { FileRef } from './file_ref.js';

const BASE = 'https://download.versatiles.org/';

function file(name: string, size: number, md5: string): FileRef {
	const f = new FileRef(`/home/download/osm/${name}`, size, `/home/download/osm/${name}`);
	f.hashes = { md5, sha256: md5 + md5 };
	return f;
}

describe('buildCatalog', () => {
	it('lists the latest release under its stable url and every release under its own', () => {
		const groups = groupFiles([file('osm.20260101.versatiles', 100, 'aa'), file('osm.20260201.versatiles', 200, 'bb')]);
		const response = buildCatalog(groups, BASE);

		expect(response.url).toBe('/catalog.json');
		expect(response.contentType).toBe('application/json');

		const { datasets } = JSON.parse(response.content);
		expect(datasets).toHaveLength(1);
		expect(datasets[0]).toMatchObject({ slug: 'osm', tileType: 'vector' });
		expect(datasets[0].latest).toEqual({
			url: `${BASE}osm.versatiles`,
			size: 200,
			md5: 'bb',
			sha256: 'bbbb',
			date: '2026-02-01',
			index: `${BASE}osm.versatiles.index.json`,
		});
		expect(datasets[0].versions.map((v: { url: string; date: string }) => [v.url, v.date])).toEqual([
			[`${BASE}osm.20260201.versatiles`, '2026-02-01'],
			[`${BASE}osm.20260101.versatiles`, '2026-01-01'],
		]);
	});

	it('gives an undated file no date', () => {
		const { datasets } = JSON.parse(buildCatalog(groupFiles([file('osm.versatiles', 1, 'cc')]), BASE).content);
		expect(datasets[0].latest.date).toBeNull();
		expect(datasets[0].versions).toEqual([]);
	});

	it('is deterministic', () => {
		const groups = groupFiles([file('osm.20260101.versatiles', 100, 'aa')]);
		expect(buildCatalog(groups, BASE).content).toBe(buildCatalog(groups, BASE).content);
	});
});
