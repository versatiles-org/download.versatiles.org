import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies from fs
vi.mock('fs', () => ({
	readdirSync: vi.fn(),
	statSync: vi.fn(),
	cpSync: vi.fn(),
	rmSync: vi.fn(),
}));

vi.spyOn(console, 'error').mockImplementation(() => { });
vi.spyOn(console, 'log').mockImplementation(() => { });

const { cpSync, rmSync } = await import('fs');
const { FileRef } = await import('./file_ref.js');
const { syncFiles } = await import('./sync.js');


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
		vi.mocked(rmSync).mockReset().mockReturnValue(undefined);
		vi.mocked(cpSync).mockReset().mockReturnValue(undefined);
	});

	it('should delete local files not in remote and copy new files from remote', async () => {
		syncFiles(remoteFiles, localFiles, '/local');

		expect(remoteFiles[0].fullname).toBe('/local/osm.versatiles');
		expect(remoteFiles[1].fullname).toBe('/local/hillshade-vectors.versatiles');
		expect(remoteFiles[2].fullname).toBe('/local/new-file.versatiles');

		// It should remove files not in remote
		expect(rmSync).toHaveBeenCalledTimes(1);
		expect(rmSync).toHaveBeenCalledWith('/local/old-file.versatiles');

		// It should copy new remote files to local
		expect(cpSync).toHaveBeenCalledTimes(1);
		expect(cpSync).toHaveBeenCalledWith('/remote/new-file.versatiles', '/local/new-file.versatiles');
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

		syncFiles(syncedRemoteFiles, syncedLocalFiles, '/local');

		expect(remoteFiles[0].fullname).toBe('/local/osm.versatiles');
		expect(remoteFiles[1].fullname).toBe('/local/hillshade-vectors.versatiles');

		// It should neither delete nor copy files
		expect(rmSync).not.toHaveBeenCalled();
		expect(cpSync).not.toHaveBeenCalled();
	});

	it('should throw error during file deletion', async () => {
		vi.mocked(rmSync).mockImplementation(() => { throw new Error('Delete error') });

		expect(() => syncFiles(remoteFiles, localFiles, '/local')).toThrow();
		expect(rmSync).toHaveBeenCalledTimes(1); // It tries to delete the file
		expect(cpSync).toHaveBeenCalledTimes(0); // It still tries to copy the new file
	});

	it('should throw error during file copying', async () => {
		vi.mocked(cpSync).mockImplementation(() => { throw new Error('Copy error') });

		expect(() => syncFiles(remoteFiles, localFiles, '/local')).toThrow();
		expect(rmSync).toHaveBeenCalledTimes(1); // It still tries to delete the old file
		expect(cpSync).toHaveBeenCalledTimes(1); // It tries to copy the file even if there is an error
	});
});
