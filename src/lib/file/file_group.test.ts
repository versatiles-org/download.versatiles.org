import { collectFiles, groupFiles, FileGroup, hex2base64 } from './file_group.js';
import { FileRef } from './file_ref.js';
import { FileResponse } from './file_response.js';
import { describe, it, expect, beforeEach } from 'vitest';

describe('groupFiles', () => {
	const files: FileRef[] = [
		new FileRef('/path/hillshade-vectors.versatiles', 200),
		new FileRef('/path/osm.2020.versatiles', 100),
		new FileRef('/path/osm.2021.versatiles', 50),
	];

	it('should correctly group files by basename', () => {
		const result: FileGroup[] = groupFiles(files);

		// Check overall grouping count
		expect(result).toHaveLength(2);

		// Validate OSM Group
		const osmGroup = result.find(group => group.title === 'OpenStreetMap as vector tiles');
		expect(osmGroup).toBeDefined();
		if (osmGroup) {
			expect(osmGroup.latestFile).toEqual(files[2]);
			expect(osmGroup.olderFiles).toEqual([files[1]]);
			expect(osmGroup.order).toBe(0);
		}

		// Validate Hillshade Group
		const hillshadeGroup = result.find(group => group.title === 'Hillshading as vector tiles');
		expect(hillshadeGroup).toBeDefined();
		if (hillshadeGroup) {
			expect(hillshadeGroup.latestFile).toEqual(files[0]);
			expect(hillshadeGroup.olderFiles).toEqual([]);
			expect(hillshadeGroup.order).toBe(10);
		}
	});

	it('should return files sorted by order', () => {
		const result: FileGroup[] = groupFiles(files);

		// Ensure the groups are sorted by their order
		expect(result[0].order).toBeLessThan(result[1].order);
	});

	it('should assign the latest file correctly', () => {
		const result: FileGroup[] = groupFiles(files);

		const osmGroup = result.find(group => group.title === 'OpenStreetMap as vector tiles');
		expect(osmGroup?.latestFile).toEqual(files[2]);

		const hillshadeGroup = result.find(group => group.title === 'Hillshading as vector tiles');
		expect(hillshadeGroup?.latestFile).toEqual(files[0]);
	});

	it('should handle olderFiles correctly', () => {
		const result: FileGroup[] = groupFiles(files);

		const osmGroup = result.find(group => group.title === 'OpenStreetMap as vector tiles');
		expect(osmGroup?.olderFiles).toEqual([files[1]]);

		const hillshadeGroup = result.find(group => group.title === 'Hillshading as vector tiles');
		expect(hillshadeGroup?.olderFiles).toHaveLength(0);
	});
});

describe('collectFiles', () => {
	const file1 = new FileRef('/path/hillshade-vectors.versatiles', 200);
	const file2 = new FileRef('/path/osm.2020.versatiles', 100);
	const file3 = new FileRef('/path/osm.2021.versatiles', 50);

	const fileGroup1 = new FileGroup({
		slug: 'hillshade-vectors',
		title: 'Hillshading as vector tiles',
		desc: 'Hillshading description',
		order: 10,
		local: false,
		latestFile: file1,
		olderFiles: []
	});

	const fileGroup2 = new FileGroup({
		slug: 'osm',
		title: 'OpenStreetMap as vector tiles',
		desc: 'OSM description',
		order: 0,
		local: true,
		latestFile: file3,
		olderFiles: [file2]
	});

	it('should collect files from individual FileRef entries', () => {
		const result = collectFiles(file1, file2, file3);
		expect(result).toEqual([file1, file2, file3]);
	});

	it('should collect files from FileGroup entries', () => {
		const result = collectFiles(fileGroup1, fileGroup2);
		expect(result).toEqual([file1, file2, file3]);
	});

	it('should collect files from mixed FileGroup and FileRef entries', () => {
		const result = collectFiles(fileGroup1, file2, fileGroup2);
		expect(result).toEqual([file1, file2, file3]);
	});

	it('should handle empty arrays in input', () => {
		const result = collectFiles([], fileGroup1, []);
		expect(result).toEqual([file1]);
	});

	it('should remove duplicate FileRefs by URL', () => {
		const duplicateFile2 = new FileRef('/path/osm.2020.versatiles', 100);
		const result = collectFiles(fileGroup1, duplicateFile2, file2);
		expect(result).toEqual([file1, file2]); // Duplicate removed
	});
});


describe('generateLists', () => {
	let fileGroup: FileGroup;

	beforeEach(() => {
		const file1 = new FileRef('/path/file1.versatiles', 1000);
		const file2 = new FileRef('/path/file2.versatiles', 2000);
		file1.hashes = { md5: 'abc', sha256: 'def' };
		file2.hashes = { md5: '123', sha256: '456' };

		fileGroup = new FileGroup({
			slug: 'slug',
			title: 'OpenStreetMap as vector tiles',
			desc: 'Test description',
			order: 0,
			local: true,
			latestFile: file1,
			olderFiles: [file2],
		});
	});

	it('should generate lists', () => {
		const result = fileGroup.getResponseUrlList('https://example.com');

		expect(result.url).toBe('urllist_slug.tsv');
		expect(result.content).toBe('TsvHttpData-1.0\\nhttps://example.com/file1.versatiles\\t1000\\tqw==\\n');
	});

	it('should generate responses', () => {
		const result = fileGroup.getResponses('https://example.com');

		expect(result.length).toBe(5);

		expect(result[0]).toStrictEqual(new FileResponse('file2.versatiles.md5', '123 file2.versatiles\n'))
		expect(result[1]).toStrictEqual(new FileResponse('file2.versatiles.sha256', '456 file2.versatiles\n'))
		expect(result[2]).toStrictEqual(new FileResponse('file1.versatiles.md5', 'abc file1.versatiles\n'))
		expect(result[3]).toStrictEqual(new FileResponse('file1.versatiles.sha256', 'def file1.versatiles\n'))
		expect(result[4]).toStrictEqual(new FileResponse('urllist_slug.tsv', 'TsvHttpData-1.0\nhttps://example.com/file1.versatiles\t1000\tqw==\n'))
	});

	it('should throw an error if hashes are missing', () => {
		// Remove the hashes from the latestFile
		fileGroup.latestFile!.hashes = undefined;

		expect(() => fileGroup.getResponseUrlList('https://example.com')).toThrow();
	});
});

describe('hex2base64', () => {
	it('should correctly convert hex to base64url', () => {
		const hex = 'deadbeef';
		const base64 = hex2base64(hex);
		expect(base64).toBe('3q2-7w=='); // Expected base64url-encoded value
	});

	it('should pad the base64 string to a multiple of 4', () => {
		const hex = 'deadbe';
		const base64 = hex2base64(hex);
		expect(base64).toBe('3q2-'); // Base64url-encoded value with correct padding
	});
});
