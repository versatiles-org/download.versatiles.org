import { jest } from '@jest/globals';
import type { FileRef } from './file/file_ref.js';
import { join } from 'path';

jest.unstable_mockModule('./file/file_ref.js', () => ({
	getAllFilesRecursive: jest.fn(),
	FileRef: jest.fn(),
}));

jest.unstable_mockModule('./file/file_group.js', () => ({
	collectFiles: jest.fn(),
	groupFiles: jest.fn(),
}));

jest.unstable_mockModule('./file/hashes.js', () => ({
	generateHashes: jest.fn(),
	generateLists: jest.fn(),
}));

jest.unstable_mockModule('./file/sync.js', () => ({
	downloadLocalFiles: jest.fn(),
}));

jest.unstable_mockModule('./html/html.js', () => ({
	generateHTML: jest.fn(),
}));

jest.unstable_mockModule('./nginx/nginx.js', () => ({
	generateNginxConf: jest.fn(),
}));

// Import the module under test after mocking modules
const { run } = await import('./run.js');
const { getAllFilesRecursive } = await import('./file/file_ref.js');
const { collectFiles, groupFiles } = await import('./file/file_group.js');
const { generateHashes, generateLists } = await import('./file/hashes.js');
const { downloadLocalFiles } = await import('./file/sync.js');
const { generateHTML } = await import('./html/html.js');
const { generateNginxConf } = await import('./nginx/nginx.js');

describe('run', () => {
	const domain = 'example.com';
	const volumeFolder = '/mock/volumes/';
	const remoteFolder = '/mock/volumes/remote_files';
	const localFolder = '/mock/volumes/local_files';
	const nginxFolder = '/mock/volumes/nginx_conf';
	const files = ['file1', 'file2'];

	beforeEach(() => {
		jest.clearAllMocks();

		// Mock getAllFilesRecursive to return a list of files
		(getAllFilesRecursive as jest.Mock).mockReturnValue(files);

		// Mock other functions to do nothing
		(generateHashes as jest.Mock<() => Promise<void>>).mockResolvedValue(undefined);
		(groupFiles as jest.Mock).mockReturnValue(files);
		(downloadLocalFiles as jest.Mock<() => Promise<void>>).mockResolvedValue(undefined);
		(generateHTML as jest.Mock).mockReturnValue({ filename: 'index.html' });
		(generateLists as jest.Mock).mockReturnValue([{ filename: 'urllist.tsv' }]);
		(collectFiles as jest.Mock).mockReturnValue([{ cloneMoved: jest.fn().mockReturnValue('movedFile') }]);
	});

	test('should throw an error if $DOMAIN is not set and no domain is provided in options', async () => {
		delete process.env['DOMAIN']; // Unset the domain

		await expect(run({ volumeFolder })).rejects.toThrow('missing $DOMAIN');
	});

	test('should use domain from options if provided', async () => {
		await run({ domain, volumeFolder });

		const expectedBaseURL = `https://${domain}/`;

		// Verify generateLists is called with the correct baseURL
		expect(generateLists).toHaveBeenCalledWith(files, expectedBaseURL, localFolder);
	});

	test('should throw an error if no files are found in the remote folder', async () => {
		// Return an empty list of files
		(getAllFilesRecursive as jest.Mock).mockReturnValue([]);

		await expect(run({ domain: domain })).rejects.toThrow('no remote files found');
	});

	test('should use volumeFolder from options if provided', async () => {
		const customVolumeFolder = '/custom/volumes/';

		await run({ domain, volumeFolder: customVolumeFolder });

		const expectedBaseURL = `https://${domain}/`;

		// Verify generateLists is called with the correct baseURL
		expect(generateLists).toHaveBeenCalledWith(files, expectedBaseURL, join(customVolumeFolder, 'local_files'));
	});

	test('should use environment variables if no options are provided', async () => {
		// Set the environment variable DOMAIN
		process.env['DOMAIN'] = domain;

		await run({ volumeFolder });

		const expectedBaseURL = `https://${domain}/`;

		// Verify generateLists is called with the correct baseURL
		expect(generateLists).toHaveBeenCalledWith(files, expectedBaseURL, localFolder);
	});

	test('should call the necessary functions with correct arguments', async () => {
		await run({ domain, volumeFolder });

		const expectedBaseURL = `https://${domain}/`;

		// Verify getAllFilesRecursive is called with the remote folder
		expect(getAllFilesRecursive).toHaveBeenCalledWith(remoteFolder);

		// Verify generateHashes is called with the correct arguments
		expect(generateHashes).toHaveBeenCalledWith(files, remoteFolder);

		// Verify groupFiles is called with the correct file list
		expect(groupFiles).toHaveBeenCalledWith(files);

		// Verify downloadLocalFiles is called with the correct arguments
		expect(downloadLocalFiles).toHaveBeenCalledWith(files, localFolder);

		// Verify generateHTML is called with the correct arguments
		expect(generateHTML).toHaveBeenCalledWith(files, `${localFolder}/index.html`);

		// Verify generateLists is called with the correct arguments
		expect(generateLists).toHaveBeenCalledWith(files, expectedBaseURL, localFolder);

		// Verify collectFiles is called and the paths are "moved"
		expect(collectFiles).toHaveBeenCalled();
		const value = jest.mocked(collectFiles).mock.results[0].value as FileRef[];
		expect(value[0].cloneMoved).toHaveBeenCalledWith(volumeFolder, '/volumes/');

		// Verify generateNginxConf is called with the moved files and the Nginx config path
		expect(generateNginxConf).toHaveBeenCalledWith(['movedFile'], `${nginxFolder}/site-confs/default.conf`);
	});
});
