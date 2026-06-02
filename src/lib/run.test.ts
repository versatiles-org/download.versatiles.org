import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FileRef } from './file/file_ref.js';
import { FileGroup } from './file/file_group.js';

vi.mock(import('./file/file_ref.js'), async originalImport => {
	const originalModule = await originalImport();
	return {
		...originalModule,
		getAllFilesRecursive: vi.fn(),
	}
});

vi.mock(import('./file/file_group.js'), async originalImport => {
	const originalModule = await originalImport();
	return {
		...originalModule,
		groupFiles: vi.fn(),
	}
});

vi.mock('./file/hashes.js', () => ({
	generateHashes: vi.fn(),
}));

vi.mock('./template/template.js', () => ({
	renderTemplate: vi.fn(),
	generateHTML: vi.fn(),
	generateRSSFeeds: vi.fn(),
}));

// Import the module under test after mocking modules
const { run } = await import('./run.js');
const { getAllFilesRecursive } = await import('./file/file_ref.js');
const { groupFiles } = await import('./file/file_group.js');
const { generateHashes } = await import('./file/hashes.js');
const { generateHTML, generateRSSFeeds } = await import('./template/template.js');

describe('run', () => {
	const domain = 'example.com';
	const volumeFolder = '/mock/volumes/';
	const remoteFolder = '/mock/volumes/remote_files';
	const localFolder = '/mock/volumes/local_files';
	const files: FileRef[] = [
		new FileRef('file1', 100),
		new FileRef('file2', 200)
	];
	files.forEach(f => f.hashes = { md5: 'md5', sha256: 'sha256' });
	const fileGroups = [new FileGroup({
		slug: 'slug',
		desc: 'desc',
		title: 'title',
		order: 123,
		olderFiles: files,
	})];

	beforeEach(() => {
		vi.clearAllMocks();

		// Mock getAllFilesRecursive to return a list of files
		vi.mocked(getAllFilesRecursive).mockReturnValue(files);

		// Mock other functions to do nothing
		vi.mocked(generateHashes).mockResolvedValue(undefined);
		vi.mocked(groupFiles).mockReturnValue(fileGroups);
		vi.mocked(generateHTML).mockReturnValue({ filename: 'index.html' } as FileRef);
		vi.mocked(generateRSSFeeds).mockReturnValue([]);
	});

	it('should throw an error if $DOMAIN is not set and no domain is provided in options', async () => {
		delete process.env['DOMAIN']; // Unset the domain

		await expect(run({ volumeFolder })).rejects.toThrow('missing $DOMAIN');
	});

	it('should throw an error if no files are found in the remote folder', async () => {
		// Return an empty list of files
		vi.mocked(getAllFilesRecursive).mockReturnValue([]);

		await expect(run({ domain })).rejects.toThrow('no remote files found');
	});

	it('should call the necessary functions with correct arguments', async () => {
		await run({ domain, volumeFolder });

		// Verify getAllFilesRecursive is called with the remote folder
		expect(getAllFilesRecursive).toHaveBeenCalledWith(remoteFolder);

		// Verify generateHashes is called with the correct arguments
		expect(generateHashes).toHaveBeenCalledWith(files, remoteFolder);

		// Verify groupFiles is called with the correct file list
		expect(groupFiles).toHaveBeenCalledWith(files);

		// Verify the static site is generated into the local folder
		expect(generateHTML).toHaveBeenCalledWith(fileGroups, `${localFolder}/index.html`);
		expect(generateRSSFeeds).toHaveBeenCalledWith(fileGroups, localFolder);
	});
});
