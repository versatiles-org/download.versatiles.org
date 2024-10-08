import type { Stats } from 'node:fs';
import { jest } from '@jest/globals';

// Mock dependencies from node:fs
jest.unstable_mockModule('node:fs', () => ({
	readdirSync: jest.fn(),
	statSync: jest.fn(),
}));

jest.spyOn(console, 'error').mockImplementation(() => { });
jest.spyOn(console, 'log').mockImplementation(() => { });

const { readdirSync, statSync } = await import('node:fs');
const { FileRef, getAllFilesRecursive } = await import('./file_ref.js');

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
});


describe('getAllFilesRecursive', () => {
	const mockFiles = ['file1.versatiles', 'file2.versatiles', 'file3.txt'];

	beforeEach(() => {
		jest.mocked(readdirSync as (path: string) => string[]).mockReset().mockReturnValue(mockFiles);
		jest.mocked(statSync as (path: string) => Stats).mockReset().mockImplementation(_ => {
			return { isDirectory: () => false, size: 100 } as Stats;
		});
	});

	it('should return an array of files with the correct information', () => {
		const folder = '/test/folder';
		const result = getAllFilesRecursive(folder);
		expect(result.length).toBe(2); // Only .versatiles files should be included
		expect(result[0].filename).toBe('file1.versatiles');
		expect(result[0].fullname).toBe('/test/folder/file1.versatiles');
		expect(result[1].filename).toBe('file2.versatiles');
		expect(result[1].fullname).toBe('/test/folder/file2.versatiles');
		expect(statSync).toHaveBeenCalledTimes(5); // statSync called for all files, but only for .versatiles a second time
	});

	it('should handle an empty folder', () => {
		jest.mocked(readdirSync).mockReturnValue([]);
		const result = getAllFilesRecursive('/empty/folder');
		expect(result.length).toBe(0);
	});

	it('should skip files that do not end with .versatiles', () => {
		jest.mocked(readdirSync as (path: string) => string[]).mockReturnValue(['file.txt', 'file.versatiles']);
		const result = getAllFilesRecursive('/folder');
		expect(result.length).toBe(1); // Only the .versatiles file should be included
		expect(result[0].filename).toBe('file.versatiles');
		expect(result[0].fullname).toBe('/folder/file.versatiles');
	});

	it('should recurse into subdirectories', () => {
		jest.mocked(readdirSync as (path: string) => string[]).mockImplementation(folderPath => {
			if (folderPath === '/test/folder') {
				return ['subfolder', 'file.versatiles'];
			} else if (folderPath === '/test/folder/subfolder') {
				return ['nestedfile.versatiles'];
			}
			return [];
		});

		jest.mocked(statSync as (path: string) => Stats).mockImplementation(filePath => {
			if (filePath === '/test/folder/subfolder') {
				return { isDirectory: () => true } as Stats; // Mock subdirectory
			}
			return { isDirectory: () => false, size: 100 } as Stats;
		});

		const result = getAllFilesRecursive('/test/folder');
		expect(result.length).toBe(2); // Files from both the root and the subfolder
		expect(result[0].filename).toBe('file.versatiles');
		expect(result[0].fullname).toBe('/test/folder/file.versatiles');
		expect(result[1].filename).toBe('nestedfile.versatiles');
		expect(result[1].fullname).toBe('/test/folder/subfolder/nestedfile.versatiles');
	});
});
