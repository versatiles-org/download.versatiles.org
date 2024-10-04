import type { Dirent, Stats } from 'node:fs';
import { jest } from '@jest/globals';

// Mock dependencies from node:fs/promises
jest.unstable_mockModule('node:fs/promises', () => ({
	readdir: jest.fn(),
	stat: jest.fn(),
	cp: jest.fn(),
	rm: jest.fn(),
}));

// Mock dependencies from node:fs
jest.unstable_mockModule('node:fs', () => ({
	statSync: jest.fn(),
}));

jest.spyOn(console, 'error').mockImplementation(() => {});
jest.spyOn(console, 'log').mockImplementation(() => {});

const { readdir, cp, rm } = await import('node:fs/promises');
const { statSync } = await import('node:fs');
const { FileRef, getAllFiles, syncFiles } = await import('./file_ref.js');


describe('FileRef', () => {
	it('should create a FileRef with correct properties from a path and size', () => {
		const fileRef = new FileRef('/path/file.versatiles', 200);
		expect(fileRef.fullname).toBe('/path/file.versatiles');
		expect(fileRef.filename).toBe('file.versatiles');
		expect(fileRef.size).toBe(200);
		expect(fileRef.url).toBe('file.versatiles');
	});

	it('should clone a FileRef object', () => {
		const fileRef = new FileRef('/path/file.versatiles', 200);
		const clonedFileRef = fileRef.clone();
		expect(clonedFileRef).not.toBe(fileRef); // Ensure it's a new object
		expect(clonedFileRef).toEqual(fileRef); // Ensure the content is the same
	});

	it('should calculate sizeString correctly', () => {
		const fileRef = new FileRef('/path/file.versatiles', 1024 * 1024 * 1024); // 1 GB
		expect(fileRef.sizeString).toBe('1.0 GB');
	});

	it('should throw an error when accessing hashes without setting them', () => {
		const fileRef = new FileRef('/path/file.versatiles', 200);
		expect(() => fileRef.md5).toThrow();
		expect(() => fileRef.sha).toThrow();
	});

	it('should set and get hashes correctly', () => {
		const fileRef = new FileRef('/path/file.versatiles', 200);
		const hashes = { md5: 'test-md5', sha: 'test-sha' };
		fileRef.setHashes(hashes);
		expect(fileRef.md5).toBe('test-md5');
		expect(fileRef.sha).toBe('test-sha');
	});
});

describe('getAllFiles', () => {
	const mockFiles = ['file1.versatiles', 'file2.versatiles', 'file3.txt'];

	beforeEach(() => {
		(readdir as jest.MockedFunction<typeof readdir>).mockResolvedValue(mockFiles as unknown as Dirent[]);
		(statSync as jest.MockedFunction<typeof statSync>).mockReturnValue({ size: 100 } as Stats);
	});

	it('should return an array of files with the correct information', async () => {
		const folder = '/test/folder';
		const result = await getAllFiles(folder);
		expect(result.length).toBe(2); // Only .versatiles files should be included
		expect(result[0].filename).toBe('file1.versatiles');
		expect(result[0].size).toBe(100);
		expect(statSync).toHaveBeenCalledTimes(2); // stat should be called only for .versatiles files
	});

	it('should handle an empty folder', async () => {
		(readdir as jest.MockedFunction<typeof readdir>).mockResolvedValue([]);
		const result = await getAllFiles('/empty/folder');
		expect(result.length).toBe(0);
	});

	it('should handle errors from readdir gracefully', async () => {
		(readdir as jest.MockedFunction<typeof readdir>).mockRejectedValue(new Error('Read error'));
		const result = await getAllFiles('/error/folder');
		expect(result).toEqual([]); // Should return an empty array on error
	});

	it('should skip files that do not end with .versatiles', async () => {
		(readdir as jest.MockedFunction<typeof readdir>).mockResolvedValue(['file.txt', 'file.versatiles'] as unknown as Dirent[]);
		const result = await getAllFiles('/folder');
		expect(result.length).toBe(1); // Only the .versatiles file should be included
		expect(result[0].filename).toBe('file.versatiles');
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

	beforeEach(() => {
		(rm as jest.MockedFunction<typeof rm>).mockReset().mockResolvedValue(undefined);
		(cp as jest.MockedFunction<typeof cp>).mockReset().mockResolvedValue(undefined);
	});

	it('should delete local files not in remote and copy new files from remote', async () => {
		await syncFiles(remoteFiles, localFiles, '/local');

		// It should remove files not in remote
		expect(rm).toHaveBeenCalledTimes(1);
		expect(rm).toHaveBeenCalledWith('/local/old-file.versatiles');

		// It should copy new remote files to local
		expect(cp).toHaveBeenCalledTimes(1);
		expect(cp).toHaveBeenCalledWith('/remote/new-file.versatiles', '/local/new-file.versatiles');
	});

	it('should not copy or delete files if they are already in sync', async () => {
		const syncedRemoteFiles = [
			new FileRef('/remote/osm.versatiles', 100),
			new FileRef('/remote/hillshade-vectors.versatiles', 200),
		];
		const syncedLocalFiles = [
			new FileRef('/local/osm.versatiles', 100),
			new FileRef('/local/hillshade-vectors.versatiles', 200),
		];

		await syncFiles(syncedRemoteFiles, syncedLocalFiles, '/local');

		// It should neither delete nor copy files
		expect(rm).not.toHaveBeenCalled();
		expect(cp).not.toHaveBeenCalled();
	});

	it('should handle errors gracefully during file deletion', async () => {
		(rm as jest.MockedFunction<typeof rm>).mockRejectedValue(new Error('Delete error'));

		await expect(syncFiles(remoteFiles, localFiles, '/local')).resolves.not.toThrow();
		expect(rm).toHaveBeenCalledTimes(1); // It tries to delete the file
		expect(cp).toHaveBeenCalledTimes(0); // It still tries to copy the new file
	});

	it('should handle errors gracefully during file copying', async () => {
		(cp as jest.MockedFunction<typeof cp>).mockRejectedValue(new Error('Copy error'));

		await expect(syncFiles(remoteFiles, localFiles, '/local')).resolves.not.toThrow();
		expect(rm).toHaveBeenCalledTimes(1); // It still tries to delete the old file
		expect(cp).toHaveBeenCalledTimes(1); // It tries to copy the file even if there is an error
	});
});
