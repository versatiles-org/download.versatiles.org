import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileRef } from './file/file_ref.js';
import { FileGroup } from './file/file_group.js';

vi.mock('./source/scan.js', () => ({
	getRemoteFiles: vi.fn(),
}));

vi.mock(import('./file/file_group.js'), async (originalImport) => {
	const originalModule = await originalImport();
	return {
		...originalModule,
		groupFiles: vi.fn(),
	};
});

vi.mock('./preflight.js', () => ({
	preflight: vi.fn(),
}));

vi.mock('./file/hashes.js', () => ({
	generateHashes: vi.fn(),
}));

vi.mock('./mirror/rclone.js', () => ({
	mirrorToR2: vi.fn(),
}));

vi.mock('./site/site.js', () => ({
	buildAndUploadSite: vi.fn(),
}));

// Import the module under test after mocking modules
const { run } = await import('./run.js');
const { preflight } = await import('./preflight.js');
const { getRemoteFiles } = await import('./source/scan.js');
const { groupFiles } = await import('./file/file_group.js');
const { generateHashes } = await import('./file/hashes.js');
const { mirrorToR2 } = await import('./mirror/rclone.js');
const { buildAndUploadSite } = await import('./site/site.js');

describe('run', () => {
	const domain = 'example.com';
	const files: FileRef[] = [new FileRef('file1', 100), new FileRef('file2', 200)];
	files.forEach((f) => (f.hashes = { md5: 'md5', sha256: 'sha256' }));
	const scanned = files.map((file) => ({ file, mtime: null, sidecars: {} }));
	const fileGroups = [
		new FileGroup({
			slug: 'slug',
			desc: ['desc'],
			title: 'title',
			order: 123,
			olderFiles: files,
		}),
	];

	beforeEach(() => {
		vi.clearAllMocks();

		vi.stubEnv('DOMAIN', domain);
		vi.stubEnv('STORAGE_URL', 'user@host');
		vi.stubEnv('RCLONE_SFTP_REMOTE', 'hetzner');
		vi.stubEnv('RCLONE_R2_REMOTE', 'r2');
		vi.stubEnv('R2_BUCKET', 'downloads');

		// Mock getRemoteFiles to return a list of files
		vi.mocked(getRemoteFiles).mockReturnValue(scanned);

		// Mock other functions to do nothing
		vi.mocked(generateHashes).mockResolvedValue(undefined);
		vi.mocked(groupFiles).mockReturnValue(fileGroups);
		vi.mocked(mirrorToR2).mockReturnValue({ uploaded: 0, skipped: 0 });
		vi.mocked(buildAndUploadSite).mockReturnValue(0);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('should throw before doing anything if the configuration is incomplete', async () => {
		vi.stubEnv('DOMAIN', undefined);
		vi.stubEnv('R2_BUCKET', undefined);

		await expect(run()).rejects.toThrow(/DOMAIN is not set[\s\S]*R2_BUCKET is not set/);
		expect(getRemoteFiles).not.toHaveBeenCalled();
	});

	it('should stop before scanning if the preflight fails', async () => {
		vi.mocked(preflight).mockRejectedValueOnce(new Error('Preflight failed'));

		await expect(run()).rejects.toThrow('Preflight failed');
		expect(getRemoteFiles).not.toHaveBeenCalled();
	});

	it('should throw an error if no files are found in the remote folder', async () => {
		// Return an empty list of files
		vi.mocked(getRemoteFiles).mockReturnValue([]);

		await expect(run()).rejects.toThrow('no remote files found');
	});

	it('should call the necessary functions with correct arguments', async () => {
		await run();

		// Verify getRemoteFiles is called
		expect(getRemoteFiles).toHaveBeenCalled();

		// Verify generateHashes is called with the scan result
		expect(generateHashes).toHaveBeenCalledWith(scanned);

		// Verify groupFiles is called with the correct file list
		expect(groupFiles).toHaveBeenCalledWith(files);

		// Verify the data files are mirrored (collected from the groups).
		expect(mirrorToR2).toHaveBeenCalledWith(files);

		// Verify the site is built and uploaded with the absolute base URL
		expect(buildAndUploadSite).toHaveBeenCalledWith(fileGroups, 'https://example.com/');
	});

	it('should mirror the data before uploading the site (atomic publish)', async () => {
		await run();

		const mirrorOrder = vi.mocked(mirrorToR2).mock.invocationCallOrder[0];
		const siteOrder = vi.mocked(buildAndUploadSite).mock.invocationCallOrder[0];
		expect(mirrorOrder).toBeLessThan(siteOrder);
	});
});
