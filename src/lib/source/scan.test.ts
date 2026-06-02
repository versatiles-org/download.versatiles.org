import { describe, it, expect, beforeEach, vi } from 'vitest';

console.log = vi.fn();

const ssh = { sshExecSync: vi.fn() };
vi.mock('./ssh.js', () => ssh);

const { getRemoteFiles } = await import('./scan.js');

describe('getRemoteFiles', () => {
	beforeEach(() => vi.clearAllMocks());

	it('parses `ls -lR` output into FileRefs and ignores sidecars/dirs', () => {
		ssh.sshExecSync.mockReturnValue({
			status: 0,
			stdout: [
				'/home:',
				'total 8',
				'drwxr-xr-x 2 u u 4096 Jan 1 12:00 osm',
				'',
				'/home/osm:',
				'total 100',
				'-rw-r--r-- 1 u u 67890 Jan 1 12:00 osm.20240701.versatiles',
				'-rw-r--r-- 1 u u 99 Jan 1 12:00 osm.20240701.versatiles.md5',
				'-rw-r--r-- 1 u u 12345 Jan 1 12:00 osm.20240101.versatiles',
			].join('\n'),
			stderr: '',
		});

		const files = getRemoteFiles();

		// Sorted by remote path; sidecar and directory entry excluded.
		expect(files.map(f => f.remotePath)).toEqual([
			'/home/osm/osm.20240101.versatiles',
			'/home/osm/osm.20240701.versatiles',
		]);
		expect(files[0].size).toBe(12345);
		expect(files[0].filename).toBe('osm.20240101.versatiles');
		expect(files[0].url).toBe('/osm.20240101.versatiles');
	});

	it('throws when the SSH scan fails', () => {
		ssh.sshExecSync.mockReturnValue({ status: 1, stdout: '', stderr: 'boom' });
		expect(() => getRemoteFiles()).toThrow(/Failed to scan remote storage/);
	});
});
