import { Dirent, Stats } from 'node:fs';
import type { File, FileGroup } from './files.js';
import { jest } from '@jest/globals'

// Mock dependencies from node:fs/promises
jest.unstable_mockModule('node:fs/promises', () => ({
	readdir: jest.fn(),
	stat: jest.fn(),
	cp: jest.fn(),
	rm: jest.fn(),
}));

const { readdir, stat, cp, rm } = await import('node:fs/promises');
const { getAllFiles, groupFiles, syncFiles } = await import('./files.js');

describe('getAllFiles', () => {
	const mockFiles = ['file1.versatiles', 'file2.versatiles', 'file3.txt'];

	beforeEach(() => {
		(readdir as jest.MockedFunction<typeof readdir>).mockResolvedValue(mockFiles as unknown as Dirent[]);
		(stat as jest.MockedFunction<typeof stat>).mockResolvedValue({ size: 100 } as Stats);
	});

	it('should return an array of files with the correct information', async () => {
		const folder = '/test/folder';
		const result = await getAllFiles(folder);
		expect(result.length).toBe(2); // Only .versatiles files should be included
		expect(result[0].filename).toBe('file1.versatiles');
		expect(result[0].size).toBe(100);
		expect(stat).toHaveBeenCalledTimes(2); // stat should be called only for .versatiles files
	});

	it('should handle an empty folder', async () => {
		(readdir as jest.MockedFunction<typeof readdir>).mockResolvedValue([]);
		const result = await getAllFiles('/empty/folder');
		expect(result.length).toBe(0);
	});
});

describe('groupFiles', () => {
	const files: File[] = [
		{ fullname: '/path/hillshade-vectors.versatiles', filename: 'hillshade-vectors.versatiles', size: 200 },
		{ fullname: '/path/osm.2020.versatiles', filename: 'osm.2020.versatiles', size: 100 },
		{ fullname: '/path/osm.2021.versatiles', filename: 'osm.2021.versatiles', size: 50 },
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

describe('syncFiles', () => {
	const localFiles: File[] = [
		{ fullname: '/local/osm.versatiles', filename: 'osm.versatiles', size: 100 },
		{ fullname: '/local/hillshade-vectors.versatiles', filename: 'hillshade-vectors.versatiles', size: 200 },
		{ fullname: '/local/old-file.versatiles', filename: 'old-file.versatiles', size: 300 },
	];

	const remoteFiles: File[] = [
		{ fullname: '/remote/osm.versatiles', filename: 'osm.versatiles', size: 100 },
		{ fullname: '/remote/hillshade-vectors.versatiles', filename: 'hillshade-vectors.versatiles', size: 200 },
		{ fullname: '/remote/new-file.versatiles', filename: 'new-file.versatiles', size: 300 },
	];

	it('should delete local files not in remote and copy new files from remote', async () => {
		await syncFiles(remoteFiles, localFiles, '/local');

		// It should remove files not in remote
		expect(rm).toHaveBeenCalledTimes(1);
		expect(rm).toHaveBeenCalledWith('/local/old-file.versatiles');

		// It should copy new remote files to local
		expect(cp).toHaveBeenCalledTimes(1);
		expect(cp).toHaveBeenCalledWith('/remote/new-file.versatiles', '/local/new-file.versatiles');
	});
});
