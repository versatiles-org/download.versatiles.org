import { collectFiles, groupFiles, isFileGroup, type FileGroup } from './file_group.js';
import { FileRef } from './file_ref.js';

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

describe('isFileGroup', () => {
	it('should return true when the object is a valid FileGroup', () => {
		const fileGroup: FileGroup = {
			slug: 'osm',
			title: 'OpenStreetMap as vector tiles',
			desc: 'A test description',
			order: 0,
			local: true,
			latestFile: new FileRef('/path/osm.2021.versatiles', 50),
			olderFiles: [new FileRef('/path/osm.2020.versatiles', 100)]
		};

		expect(isFileGroup(fileGroup)).toBe(true);
	});

	it('should return false when the object is not a valid FileGroup', () => {
		const invalidFileGroup = {
			slug: 'osm',
			// Missing title and other required properties
		};

		expect(isFileGroup(invalidFileGroup)).toBe(false);

		const fileRef = new FileRef('/path/osm.2021.versatiles', 50);
		expect(isFileGroup(fileRef)).toBe(false);
	});
});

describe('collectFiles', () => {
	const file1 = new FileRef('/path/hillshade-vectors.versatiles', 200);
	const file2 = new FileRef('/path/osm.2020.versatiles', 100);
	const file3 = new FileRef('/path/osm.2021.versatiles', 50);

	const fileGroup1: FileGroup = {
		slug: 'hillshade-vectors',
		title: 'Hillshading as vector tiles',
		desc: 'Hillshading description',
		order: 10,
		local: false,
		latestFile: file1,
		olderFiles: []
	};

	const fileGroup2: FileGroup = {
		slug: 'osm',
		title: 'OpenStreetMap as vector tiles',
		desc: 'OSM description',
		order: 0,
		local: true,
		latestFile: file3,
		olderFiles: [file2]
	};

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
