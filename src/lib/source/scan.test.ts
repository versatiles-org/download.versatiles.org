import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

console.log = vi.fn();

const ssh = {
	sshExecSync: vi.fn(),
	connectionFailed: (result: { status: number }) => result.status === 255,
};
vi.mock('./ssh.js', () => ssh);

const { getRemoteFiles } = await import('./scan.js');

const ok = (lines: string[]) => ({ success: true, status: 0, stdout: lines.join('\n'), stderr: '' });

/** A listing as `ls -lR --time-style=+%s` prints it. */
const EPOCH_LISTING = [
	'/home:',
	'total 8',
	'drwxr-xr-x 2 u u 4096 1700000000 osm',
	'',
	'/home/osm:',
	'total 100',
	'-rw-r--r-- 1 u u 67890 1700000200 osm.20240701.versatiles',
	'-rw-r--r-- 1 u u 99 1700000300 osm.20240701.versatiles.md5',
	'-rw-r--r-- 1 u u 131 1700000100 osm.20240701.versatiles.sha256',
	'-rw-r--r-- 1 u u 12345 1600000000 osm.20240101.versatiles',
	'lrwxrwxrwx 1 u u 23 1700000000 osm.versatiles -> osm.20240701.versatiles',
];

describe('getRemoteFiles', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubEnv('STORAGE_URL', 'user@host');
		vi.stubEnv('STORAGE_ROOT', undefined);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('parses one listing into FileRefs, ignoring sidecars, directories and symlinks', () => {
		ssh.sshExecSync.mockReturnValue(ok(EPOCH_LISTING));

		const files = getRemoteFiles();

		// Sorted by remote path.
		expect(files.map((f) => f.file.remotePath)).toEqual([
			'/home/osm/osm.20240101.versatiles',
			'/home/osm/osm.20240701.versatiles',
		]);
		expect(files[0].file.size).toBe(12345);
		expect(files[0].file.filename).toBe('osm.20240101.versatiles');
		expect(files[0].file.url).toBe('/osm.20240101.versatiles');
		expect(ssh.sshExecSync).toHaveBeenCalledTimes(1);
		expect(ssh.sshExecSync.mock.calls[0][0]).toEqual(['ls', '-lR', '--time-style=+%s', '/home']);
	});

	it('records the modification times of each file and of the sidecars that exist', () => {
		ssh.sshExecSync.mockReturnValue(ok(EPOCH_LISTING));

		const [older, newer] = getRemoteFiles();

		expect(newer.mtime).toBe(1700000200);
		expect(newer.sidecars).toEqual({ md5: { mtime: 1700000300 }, sha256: { mtime: 1700000100 } });
		// No sidecars listed next to the older file.
		expect(older.mtime).toBe(1600000000);
		expect(older.sidecars).toEqual({});
	});

	it('only pairs a sidecar with the data file in the same directory', () => {
		ssh.sshExecSync.mockReturnValue(
			ok([
				'/home/a:',
				'-rw-r--r-- 1 u u 10 1700000000 osm.versatiles',
				'',
				'/home/b:',
				'-rw-r--r-- 1 u u 99 1700000000 osm.versatiles.md5',
			]),
		);

		expect(getRemoteFiles()[0].sidecars).toEqual({});
	});

	it('keeps file names that contain spaces', () => {
		ssh.sshExecSync.mockReturnValue(ok(['/home:', '-rw-r--r-- 1 u u 10 1700000000 my file.versatiles']));

		expect(getRemoteFiles()[0].file.remotePath).toBe('/home/my file.versatiles');
	});

	it('scans only the subtree given by STORAGE_ROOT', () => {
		vi.stubEnv('STORAGE_ROOT', '/home/download');
		ssh.sshExecSync.mockReturnValue(ok([]));

		getRemoteFiles();

		expect(ssh.sshExecSync.mock.calls[0][0]).toEqual(['ls', '-lR', '--time-style=+%s', '/home/download']);
	});

	it('falls back to a plain listing without timestamps when --time-style is not supported', () => {
		ssh.sshExecSync
			.mockReturnValueOnce({ success: false, status: 2, stdout: '', stderr: 'ls: unrecognized option' })
			.mockReturnValueOnce(
				ok([
					'/home/osm:',
					'-rw-r--r-- 1 u u 67890 Jan 1 12:00 osm.20240701.versatiles',
					'-rw-r--r-- 1 u u 99 Jan 1 2024 osm.20240701.versatiles.md5',
				]),
			);

		const files = getRemoteFiles();

		expect(ssh.sshExecSync.mock.calls[1][0]).toEqual(['ls', '-lR', '/home']);
		expect(files).toHaveLength(1);
		expect(files[0].file.size).toBe(67890);
		expect(files[0].mtime).toBeNull();
		expect(files[0].sidecars).toEqual({ md5: { mtime: null } });
	});

	it('throws when the SSH scan fails', () => {
		ssh.sshExecSync.mockReturnValue({ success: false, status: 2, stdout: '', stderr: 'boom' });
		expect(() => getRemoteFiles()).toThrow(/Failed to scan remote storage via SSH: boom/);
	});

	it('does not retry without --time-style when the connection failed', () => {
		ssh.sshExecSync.mockReturnValue({ success: false, status: 255, stdout: '', stderr: 'Connection refused' });

		expect(() => getRemoteFiles()).toThrow(/Connection refused/);
		expect(ssh.sshExecSync).toHaveBeenCalledTimes(1);
	});
});
