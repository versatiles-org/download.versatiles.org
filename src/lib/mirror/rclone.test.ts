import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

console.log = vi.fn();

const cp = { spawnSync: vi.fn() };
vi.mock('child_process', () => cp);

const { FileRef } = await import('../file/file_ref.js');
const { mirrorToR2, uploadObject, uploadDir } = await import('./rclone.js');

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

describe('mirrorToR2', () => {
	it('skips files whose R2 md5 already matches', () => {
		cp.spawnSync.mockImplementation((_bin: string, args: string[]) =>
			args[0] === 'lsjson' ? { status: 0, stdout: JSON.stringify([{ Metadata: { md5: 'abc' } }]) } : { status: 0 },
		);

		const stats = mirrorToR2([dataFile('/home/osm/osm.20240701.versatiles', '/osm.versatiles', 'abc')]);

		expect(stats).toEqual({ uploaded: 0, skipped: 1 });
		expect(copytoArgs()).toBeUndefined();
	});

	it('uploads when the R2 md5 differs, mapping source → flat key', () => {
		cp.spawnSync.mockImplementation((_bin: string, args: string[]) =>
			args[0] === 'lsjson' ? { status: 0, stdout: JSON.stringify([{ Metadata: { md5: 'old' } }]) } : { status: 0 },
		);

		const stats = mirrorToR2([dataFile('/home/osm/osm.20240701.versatiles', '/osm.versatiles', 'new')]);

		expect(stats).toEqual({ uploaded: 1, skipped: 0 });
		const args = copytoArgs()!;
		// SFTP source is home-relative (no /home prefix); R2 dest is the flat key.
		expect(args).toContain('hetzner:osm/osm.20240701.versatiles');
		expect(args).toContain('r2:downloads/osm.versatiles');
		expect(args).toContain('md5=new');
		expect(args).toContain('sha256=sha-new');
		expect(args).toContain('content-type=application/octet-stream');
	});

	it('uploads when the R2 object does not exist yet', () => {
		cp.spawnSync.mockImplementation((_bin: string, args: string[]) =>
			args[0] === 'lsjson' ? { status: 3, stdout: '' } : { status: 0 },
		);

		const stats = mirrorToR2([dataFile('/home/osm/osm.versatiles', '/osm.versatiles', 'abc')]);

		expect(stats).toEqual({ uploaded: 1, skipped: 0 });
	});

	it('throws when an upload fails', () => {
		cp.spawnSync.mockImplementation((_bin: string, args: string[]) =>
			args[0] === 'lsjson' ? { status: 3, stdout: '' } : { status: 1, stderr: 'boom' },
		);

		expect(() => mirrorToR2([dataFile('/home/osm/osm.versatiles', '/osm.versatiles', 'abc')])).toThrow(
			/rclone failed to upload osm.versatiles/,
		);
	});

	it('throws when required configuration is missing', () => {
		delete process.env['R2_BUCKET'];
		expect(() => mirrorToR2([dataFile('/home/osm/osm.versatiles', '/osm.versatiles', 'abc')])).toThrow(/R2_BUCKET/);
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
