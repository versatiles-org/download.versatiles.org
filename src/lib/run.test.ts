import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FileRef } from './file/file_ref.js';
import { FileGroup } from './file/file_group.js';

vi.mock('./source/scan.js', () => ({
	getRemoteFiles: vi.fn(),
}));

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

vi.mock('./site/site.js', () => ({
	buildAndUploadSite: vi.fn(),
}));

// Import the module under test after mocking modules
const { run } = await import('./run.js');
const { getRemoteFiles } = await import('./source/scan.js');
const { groupFiles } = await import('./file/file_group.js');
const { generateHashes } = await import('./file/hashes.js');
const { buildAndUploadSite } = await import('./site/site.js');

describe('run', () => {
	const domain = 'example.com';
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

		// Mock getRemoteFiles to return a list of files
		vi.mocked(getRemoteFiles).mockReturnValue(files);

		// Mock other functions to do nothing
		vi.mocked(generateHashes).mockResolvedValue(undefined);
		vi.mocked(groupFiles).mockReturnValue(fileGroups);
		vi.mocked(buildAndUploadSite).mockReturnValue(0);
	});

	it('should throw an error if $DOMAIN is not set and no domain is provided in options', async () => {
		delete process.env['DOMAIN']; // Unset the domain

		await expect(run({})).rejects.toThrow('missing $DOMAIN');
	});

	it('should throw an error if no files are found in the remote folder', async () => {
		// Return an empty list of files
		vi.mocked(getRemoteFiles).mockReturnValue([]);

		await expect(run({ domain })).rejects.toThrow('no remote files found');
	});

	it('should call the necessary functions with correct arguments', async () => {
		await run({ domain });

		// Verify getRemoteFiles is called
		expect(getRemoteFiles).toHaveBeenCalled();

		// Verify generateHashes is called with the file list
		expect(generateHashes).toHaveBeenCalledWith(files);

		// Verify groupFiles is called with the correct file list
		expect(groupFiles).toHaveBeenCalledWith(files);

		// Verify the site is built and uploaded with the absolute base URL
		expect(buildAndUploadSite).toHaveBeenCalledWith(fileGroups, 'https://example.com/');
	});
});
