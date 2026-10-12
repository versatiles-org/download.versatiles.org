import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

console.log = vi.fn();

const cp = { spawnSync: vi.fn() };
vi.mock('child_process', () => cp);

const { FileRef } = await import('../file/file_ref.js');
const {
	uploadDataFile,
	copyDataFile,
	copyObject,
	remoteObject,
	remoteMd5,
	uploadObject,
	uploadDir,
	listRemoteDataFiles,
} = await import('./rclone.js');

/** Builds a remote data FileRef with a given destination url and md5. */
function dataFile(remotePath: string, url: string, md5: string): InstanceType<typeof FileRef> {
	const f = new FileRef(remotePath, 2 ** 30, remotePath);
	f.url = url;
	f.hashes = { md5, sha256: `sha-${md5}` };
	return f;
}

/** Finds the args of the (single) `copyto` invocation, or undefined. */
function copytoArgs(): string[] | undefined {
	const call = cp.spawnSync.mock.calls.find((c) => (c[1] as string[])[0] === 'copyto');
	return call?.[1] as string[] | undefined;
}

const ENV_KEYS = ['RCLONE_SFTP_REMOTE', 'RCLONE_R2_REMOTE', 'R2_BUCKET'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
	vi.clearAllMocks();
	for (const k of ENV_KEYS) saved[k] = process.env[k];
	process.env['RCLONE_SFTP_REMOTE'] = 'hetzner';
	process.env['RCLONE_R2_REMOTE'] = 'r2';
	process.env['R2_BUCKET'] = 'downloads';
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

/** Scripts `lsjson` (reading an object back) and the result of every other rclone command. */
function rcloneReturns(readBack: { Size: number; Metadata?: Record<string, string> } | null, transferStatus = 0): void {
	cp.spawnSync.mockImplementation((_bin: string, args: string[]) => {
		if (args[0] !== 'lsjson') return { status: transferStatus };
		return readBack ? { status: 0, stdout: JSON.stringify([readBack]) } : { status: 3, stdout: '' };
	});
}

describe('uploadDataFile', () => {
	const file = () => dataFile('/home/osm/osm.20240701.versatiles', '/osm.20240701.versatiles', 'new');

	it('uploads from the Storage Box to the flat key, recording the checksums', () => {
		rcloneReturns({ Size: 2 ** 30, Metadata: { md5: 'new' } });

		uploadDataFile(file());

		const args = copytoArgs()!;
		// SFTP source is home-relative (no /home prefix); R2 dest is the flat key.
		expect(args.slice(-2)).toEqual(['hetzner:osm/osm.20240701.versatiles', 'r2:downloads/osm.20240701.versatiles']);
		expect(args).toContain('md5=new');
		expect(args).toContain('sha256=sha-new');
		expect(args).toContain('content-type=application/octet-stream');
	});

	it('throws when the upload fails', () => {
		rcloneReturns(null, 1);
		expect(() => uploadDataFile(file())).toThrow(/rclone failed to upload osm.20240701.versatiles/);
	});

	it('throws when the object cannot be read back', () => {
		rcloneReturns(null);
		expect(() => uploadDataFile(file())).toThrow(/cannot be read back from R2/);
	});

	it('throws when the object on R2 has a different size', () => {
		rcloneReturns({ Size: 2 ** 30 - 1, Metadata: { md5: 'new' } });
		expect(() => uploadDataFile(file())).toThrow(/has 1073741823 bytes on R2 after the transfer, expected 1073741824/);
	});

	it('throws when the object on R2 carries a different md5', () => {
		rcloneReturns({ Size: 2 ** 30, Metadata: { md5: 'old' } });
		expect(() => uploadDataFile(file())).toThrow(/carries md5 "old"/);
	});

	it('throws when required configuration is missing', () => {
		delete process.env['R2_BUCKET'];
		expect(() => uploadDataFile(file())).toThrow(/R2_BUCKET/);
	});
});

describe('copyDataFile', () => {
	const release = () => dataFile('/home/osm/osm.20240701.versatiles', '/osm.20240701.versatiles', 'abc');
	const stable = () => dataFile('/home/osm/osm.20240701.versatiles', '/osm.versatiles', 'abc');

	it('copies between two keys of the bucket, never from the Storage Box', () => {
		rcloneReturns({ Size: 2 ** 30, Metadata: { md5: 'abc' } });

		copyDataFile(release(), stable());

		const args = copytoArgs()!;
		expect(args.slice(-2)).toEqual(['r2:downloads/osm.20240701.versatiles', 'r2:downloads/osm.versatiles']);
		expect(args).toContain('--metadata');
		expect(args.some((arg) => arg.startsWith('hetzner:'))).toBe(false);
	});

	it('throws when the copy fails', () => {
		rcloneReturns(null, 1);
		expect(() => copyDataFile(release(), stable())).toThrow(
			/rclone failed to copy osm.20240701.versatiles to osm.versatiles/,
		);
	});

	it('throws when the copy lost the checksum metadata', () => {
		rcloneReturns({ Size: 2 ** 30 });
		expect(() => copyDataFile(release(), stable())).toThrow(/osm.versatiles carries md5 "null"/);
	});
});

describe('remoteObject', () => {
	it('returns size and checksums of an object', () => {
		rcloneReturns({ Size: 5, Metadata: { md5: 'abc', sha256: 'def' } });
		expect(remoteObject('/osm.versatiles')).toEqual({ size: 5, md5: 'abc', sha256: 'def' });
		expect(remoteMd5('/osm.versatiles')).toBe('abc');
	});

	it('returns null when the object cannot be read', () => {
		rcloneReturns(null);
		expect(remoteObject('/osm.versatiles')).toBeNull();
		expect(remoteMd5('/osm.versatiles')).toBeNull();
	});
});

describe('listRemoteDataFiles', () => {
	it('lists the data files of the bucket in one call, keyed by url', () => {
		cp.spawnSync.mockReturnValue({
			status: 0,
			stdout: JSON.stringify([
				{ Path: 'osm.versatiles', Size: 100, Metadata: { md5: 'abc', sha256: 'def', mtime: 'x' } },
				{ Path: 'satellite.versatiles', Size: 200, Metadata: { 'content-type': 'application/octet-stream' } },
				{ Path: 'elevation.versatiles', Size: 300 },
			]),
		});

		expect(listRemoteDataFiles()).toEqual(
			new Map([
				['/osm.versatiles', { size: 100, md5: 'abc', sha256: 'def' }],
				['/satellite.versatiles', { size: 200, md5: null, sha256: null }],
				['/elevation.versatiles', { size: 300, md5: null, sha256: null }],
			]),
		);
		expect(cp.spawnSync).toHaveBeenCalledTimes(1);
		expect(cp.spawnSync.mock.calls[0][1]).toEqual([
			'lsjson',
			'--files-only',
			'--metadata',
			'--include',
			'*.versatiles',
			'r2:downloads',
		]);
	});

	it('returns an empty map for an empty bucket', () => {
		cp.spawnSync.mockReturnValue({ status: 0, stdout: '[]' });
		expect(listRemoteDataFiles().size).toBe(0);
	});

	it('throws when the bucket cannot be listed, rather than reporting it empty', () => {
		cp.spawnSync.mockReturnValue({ status: 1, stdout: '', stderr: 'NOTICE: x\n401 Unauthorized' });
		expect(() => listRemoteDataFiles()).toThrow(/failed to list the bucket \(exit 1\): 401 Unauthorized/);
	});
});

describe('uploadObject', () => {
	it('uploads content via rcat with the given content-type', () => {
		cp.spawnSync.mockReturnValue({ status: 0, stdout: '' });

		uploadObject('/index.html', '<html></html>', 'text/html');

		const call = cp.spawnSync.mock.calls[0];
		const args = call[1] as string[];
		const opts = call[2] as { input?: string };
		expect(args[0]).toBe('rcat');
		expect(args).toContain('content-type=text/html');
		expect(args).toContain('r2:downloads/index.html');
		expect(opts.input).toBe('<html></html>');
	});

	it('throws when the upload fails', () => {
		cp.spawnSync.mockReturnValue({ status: 1, stderr: 'boom' });
		expect(() => uploadObject('/index.html', 'x', 'text/html')).toThrow(/rclone failed to upload index.html/);
	});
});

describe('copyObject', () => {
	it('copies between two keys of the bucket, keeping the metadata', () => {
		cp.spawnSync.mockReturnValue({ status: 0, stdout: '' });

		copyObject('/osm.20260105.versatiles.index.json', '/osm.versatiles.index.json');

		expect(cp.spawnSync.mock.calls[0][1]).toEqual([
			'copyto',
			'--metadata',
			'r2:downloads/osm.20260105.versatiles.index.json',
			'r2:downloads/osm.versatiles.index.json',
		]);
	});

	it('throws when the copy fails', () => {
		cp.spawnSync.mockReturnValue({ status: 1, stdout: '' });
		expect(() => copyObject('/a.json', '/b.json')).toThrow(/rclone failed to copy a.json to b.json/);
	});
});

describe('uploadDir', () => {
	it('copies a local dir to the bucket root', () => {
		cp.spawnSync.mockReturnValue({ status: 0 });

		uploadDir('/repo/build');

		const args = cp.spawnSync.mock.calls[0][1] as string[];
		expect(args[0]).toBe('copy');
		expect(args).toContain('/repo/build');
		expect(args).toContain('r2:downloads');
	});

	it('throws when the copy fails', () => {
		cp.spawnSync.mockReturnValue({ status: 1 });
		expect(() => uploadDir('/repo/build')).toThrow(/rclone failed to upload \/repo\/build/);
	});
});
