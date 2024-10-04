import { groupFiles, type FileGroup } from './file_group.js';
import { FileRef } from './file_ref.js';

describe('groupFiles', () => {
	const files: FileRef[] = [
		new FileRef('/path/hillshade-vectors.versatiles', 200),
		new FileRef('/path/osm.2020.versatiles', 100),
		new FileRef('/path/osm.2021.versatiles', 50),
	];

	it('should group files by basename and assign correct titles and order', () => {
		const result: FileGroup[] = groupFiles(files);
		expect(result.length).toBe(2);

		const osmGroup = result.find(group => group.title === 'OpenStreetMap as vector tiles');
		expect(osmGroup).toBeDefined();
		expect(osmGroup?.latestFile).toEqual(files[2]);
		expect(osmGroup?.olderFiles).toEqual([files[1]]);
		expect(osmGroup?.order).toBe(0);

		const hillshadeGroup = result.find(group => group.title === 'Hillshading as vector tiles');
		expect(hillshadeGroup).toBeDefined();
		expect(hillshadeGroup?.latestFile).toEqual(files[0]);
		expect(hillshadeGroup?.olderFiles).toEqual([]);
		expect(hillshadeGroup?.order).toBe(10);
	});
});
