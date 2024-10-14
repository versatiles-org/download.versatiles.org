import { jest } from '@jest/globals';
import { FileRef } from './file/file_ref.js';
import { FileGroup } from './file/file_group.js';

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
const { generateHashes } = await import('./file/hashes.js');
const { downloadLocalFiles } = await import('./file/sync.js');
const { generateHTML } = await import('./html/html.js');
const { generateNginxConf } = await import('./nginx/nginx.js');

describe('run', () => {
	const domain = 'example.com';
	const volumeFolder = '/mock/volumes/';
	const remoteFolder = '/mock/volumes/remote_files';
	const localFolder = '/mock/volumes/local_files';
	const nginxFolder = '/mock/volumes/nginx_conf';
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
		jest.clearAllMocks();

		// Mock getAllFilesRecursive to return a list of files
		(getAllFilesRecursive as jest.Mock).mockReturnValue(files);

		// Mock other functions to do nothing
		(generateHashes as jest.Mock<() => Promise<void>>).mockResolvedValue(undefined);
		(groupFiles as jest.Mock).mockReturnValue(fileGroups);
		(downloadLocalFiles as jest.Mock<() => Promise<void>>).mockResolvedValue(undefined);
		(generateHTML as jest.Mock).mockReturnValue({ filename: 'index.html' });
		(collectFiles as jest.Mock).mockReturnValue([{ cloneMoved: jest.fn().mockReturnValue('movedFile') }]);
	});

	test('should throw an error if $DOMAIN is not set and no domain is provided in options', async () => {
		delete process.env['DOMAIN']; // Unset the domain

		await expect(run({ volumeFolder })).rejects.toThrow('missing $DOMAIN');
	});

	test('should throw an error if no files are found in the remote folder', async () => {
		// Return an empty list of files
		(getAllFilesRecursive as jest.Mock).mockReturnValue([]);

		await expect(run({ domain: domain })).rejects.toThrow('no remote files found');
	});

	test('should call the necessary functions with correct arguments', async () => {
		await run({ domain, volumeFolder });

		// Verify getAllFilesRecursive is called with the remote folder
		expect(getAllFilesRecursive).toHaveBeenCalledWith(remoteFolder);

		// Verify generateHashes is called with the correct arguments
		expect(generateHashes).toHaveBeenCalledWith(files, remoteFolder);

		// Verify groupFiles is called with the correct file list
		expect(groupFiles).toHaveBeenCalledWith(files);

		// Verify downloadLocalFiles is called with the correct arguments
		expect(downloadLocalFiles).toHaveBeenCalledWith(fileGroups, localFolder);

		// Verify generateHTML is called with the correct arguments
		expect(generateHTML).toHaveBeenCalledWith(fileGroups, `${localFolder}/index.html`);

		// Verify collectFiles is called and the paths are "moved"
		expect(collectFiles).toHaveBeenCalled();
		const value = jest.mocked(collectFiles).mock.results[0].value as FileRef[];
		expect(value[0].cloneMoved).toHaveBeenCalledWith(volumeFolder, '/volumes/');

		// Verify generateNginxConf is called with the moved files and the Nginx config path
		expect(generateNginxConf).toHaveBeenCalledWith(
			['movedFile'],
			[1, 2].flatMap(i => ['md5', 'sha256'].flatMap(h => [{ content: `${h} file${i}\\n`, url: `file${i}.${h}` }])),
			`${nginxFolder}/site-confs/default.conf`
		);
	});
});
