import { describe, it, expect } from 'vitest';
import { DATASETS, assertKnownDatasets, datasetOf, slugOf, unknownFiles } from './datasets.js';

describe('DATASETS', () => {
	it('lists the published datasets in display order', () => {
		const slugs = Object.keys(DATASETS).sort((a, b) => DATASETS[a].order - DATASETS[b].order);

		expect(slugs).toEqual([
			'osm-vector',
			'satellite-raster',
			'elevation-raster',
			'landcover-vector',
			'hillshade-vector',
			'bathymetry-vector',
		]);
	});

	it('gives every dataset a title, a description and a distinct order', () => {
		const orders = new Set<number>();
		for (const [slug, dataset] of Object.entries(DATASETS)) {
			expect(dataset.title, slug).not.toBe('');
			expect(dataset.desc.length, slug).toBeGreaterThan(0);
			orders.add(dataset.order);
		}
		expect(orders.size).toBe(Object.keys(DATASETS).length);
	});

	it('marks the raster datasets', () => {
		const raster = Object.keys(DATASETS).filter((slug) => DATASETS[slug].tileType === 'raster');

		expect(raster.sort()).toEqual(['elevation-raster', 'satellite-raster']);
	});
});

describe('slugOf', () => {
	it.each([
		['osm-vector.20260105.versatiles', 'osm-vector'],
		['satellite-raster.versatiles', 'satellite-raster'],
		['landcover-vector.20260105.versatiles', 'landcover-vector'],
		['/home/download/osm-vector.versatiles', 'osm-vector'],
	])('%s → %s', (filename, slug) => {
		expect(slugOf(filename)).toBe(slug);
	});
});

describe('datasetOf', () => {
	it('finds a published dataset', () => {
		expect(datasetOf('osm-vector')?.title).toBe('OpenStreetMap');
	});

	it('does not mistake inherited object properties for datasets', () => {
		expect(datasetOf('constructor')).toBeUndefined();
		expect(datasetOf('toString')).toBeUndefined();
	});
});

describe('unknownFiles', () => {
	it('returns the files that belong to no published dataset', () => {
		const files = [
			'osm-vector.20260105.versatiles',
			'test.versatiles',
			'satellite-raster.versatiles',
			'osm2.versatiles',
		];

		expect(unknownFiles(files)).toEqual(['test.versatiles', 'osm2.versatiles']);
	});
});

describe('assertKnownDatasets', () => {
	it('passes when every file belongs to a published dataset', () => {
		expect(() => assertKnownDatasets(['osm-vector.20260105.versatiles', 'satellite-raster.versatiles'])).not.toThrow();
	});

	it('names every unknown file and says what to do', () => {
		expect(() =>
			assertKnownDatasets(['osm-vector.versatiles', 'test.versatiles', 'backup.20260101.versatiles']),
		).toThrow(
			[
				'Found files on the Storage Box that belong to no known dataset:',
				' - test.versatiles',
				' - backup.20260101.versatiles',
				'Add the dataset to src/lib/file/datasets.ts, or move the file out of the scanned folder (STORAGE_ROOT).',
			].join('\n'),
		);
	});

	it('uses the singular for a single file', () => {
		expect(() => assertKnownDatasets(['test.versatiles'])).toThrow(
			/^Found a file on the Storage Box that belongs to no known dataset:/,
		);
	});
});
