import { Dirent, Stats } from 'node:fs';
import { jest } from '@jest/globals'

// Mock dependencies from node:fs/promises
jest.unstable_mockModule('node:fs/promises', () => ({
	readdir: jest.fn(),
	stat: jest.fn(),
	cp: jest.fn(),
	rm: jest.fn(),
}));

const { readdir, stat, cp, rm } = await import('node:fs/promises');
const { FileRef, getAllFiles, syncFiles } = await import('./file_ref.js');

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

describe('syncFiles', () => {
	const localFiles = [
		new FileRef('/local/osm.versatiles', 100),
		new FileRef('/local/hillshade-vectors.versatiles', 200),
		new FileRef('/local/old-file.versatiles', 300),
	];

	const remoteFiles = [
		new FileRef('/remote/osm.versatiles', 100),
		new FileRef('/remote/hillshade-vectors.versatiles', 200),
		new FileRef('/remote/new-file.versatiles', 300),
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
