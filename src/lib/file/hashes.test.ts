import { describe, it, expect, beforeEach, vi } from 'vitest';

console.log = vi.fn();

const ssh = {
	sshExec: vi.fn(),
	scpUpload: vi.fn(),
	connectionFailed: (result: { status: number }) => result.status === 255,
};

/** A remote command that ran and succeeded. */
const ok = (stdout: string) => ({ success: true, status: 0, stdout, stderr: '' });
/** A remote command that ran and failed, e.g. `cat` of a file that does not exist. */
const failed = { success: false, status: 1, stdout: '', stderr: 'No such file or directory' };
/** ssh itself failed: no answer from the remote command. */
const unreachable = { success: false, status: 255, stdout: '', stderr: 'Connection timed out' };
vi.mock('../source/ssh.js', () => ssh);

vi.mock('fs', () => ({
	writeFileSync: vi.fn(),
	unlinkSync: vi.fn(),
}));

vi.mock('os', () => ({ tmpdir: () => '/tmp' }));

const { FileRef } = await import('./file_ref.js');
const { generateHashes } = await import('./hashes.js');
const { writeFileSync, unlinkSync } = await import('fs');

const MD5 = 'a'.repeat(32);
const SHA = 'b'.repeat(64);

function remoteFile(remotePath: string): InstanceType<typeof FileRef> {
	return new FileRef(remotePath, 100, remotePath);
}

/** `ls -l --time-style=+%s` line for a path with a given epoch mtime. */
function lsLine(path: string, mtime: number): string {
	return `-rw-r--r-- 1 u u 100 ${mtime} ${path}`;
}

describe('generateHashes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('uses fresh existing sidecars (sidecar newer than data)', async () => {
		ssh.sshExec.mockImplementation(async (args: string[]) => {
			if (args[0] === 'cat') {
				const hash = args[1].endsWith('.md5') ? MD5 : SHA;
				return ok(`${hash}  file.versatiles\n`);
			}
			if (args[0] === 'ls') {
				const data = args[3];
				const sidecar = args[4];
				// sidecar (2000) newer than data (1000) → fresh
				return ok(`${lsLine(data, 1000)}\n${lsLine(sidecar, 2000)}`);
			}
			return failed;
		});

		const file = remoteFile('/home/osm/osm.versatiles');
		await generateHashes([file]);

		expect(file.hashes?.md5).toBe(MD5);
		expect(file.hashes?.sha256).toBe(SHA);
		expect(ssh.scpUpload).not.toHaveBeenCalled();
		expect(writeFileSync).not.toHaveBeenCalled();
	});

	it('recomputes when the sidecar is missing', async () => {
		ssh.sshExec.mockImplementation(async (args: string[]) => {
			if (args[0] === 'cat') return failed;
			if (args[0] === 'ls') return failed;
			const type = args[0].replace('sum', '');
			return ok(`${type === 'md5' ? MD5 : SHA}  /home/osm/osm.versatiles\n`);
		});
		ssh.scpUpload.mockResolvedValue(true);

		const file = remoteFile('/home/osm/osm.versatiles');
		await generateHashes([file]);

		expect(file.hashes?.md5).toBe(MD5);
		expect(file.hashes?.sha256).toBe(SHA);
		expect(ssh.sshExec).toHaveBeenCalledWith(['md5sum', '/home/osm/osm.versatiles']);
		expect(ssh.scpUpload).toHaveBeenCalledTimes(2);
		expect(writeFileSync).toHaveBeenCalledTimes(2);
		expect(unlinkSync).toHaveBeenCalledTimes(2);
	});

	it('recomputes when the sidecar is stale (older than the data file)', async () => {
		ssh.sshExec.mockImplementation(async (args: string[]) => {
			if (args[0] === 'cat') {
				const hash = args[1].endsWith('.md5') ? MD5 : SHA;
				return ok(`${hash}  file.versatiles\n`);
			}
			if (args[0] === 'ls') {
				const data = args[3];
				const sidecar = args[4];
				// data (2000) newer than sidecar (1000) → stale → recompute
				return ok(`${lsLine(data, 2000)}\n${lsLine(sidecar, 1000)}`);
			}
			const type = args[0].replace('sum', '');
			return ok(`${type === 'md5' ? MD5 : SHA}  /home/osm/osm.versatiles\n`);
		});
		ssh.scpUpload.mockResolvedValue(true);

		const file = remoteFile('/home/osm/osm.versatiles');
		await generateHashes([file]);

		expect(file.hashes?.md5).toBe(MD5);
		expect(file.hashes?.sha256).toBe(SHA);
		// stale → both types recomputed + re-uploaded
		expect(ssh.sshExec).toHaveBeenCalledWith(['md5sum', '/home/osm/osm.versatiles']);
		expect(ssh.sshExec).toHaveBeenCalledWith(['sha256sum', '/home/osm/osm.versatiles']);
		expect(ssh.scpUpload).toHaveBeenCalledTimes(2);
	});

	it('throws when a hash can neither be downloaded nor computed', async () => {
		ssh.sshExec.mockResolvedValue(failed);

		const file = remoteFile('/home/osm/osm.versatiles');
		await expect(generateHashes([file])).rejects.toThrow(/Failed to calculate.*No such file/);
	});

	it('aborts instead of recomputing when the Storage Box cannot be reached', async () => {
		ssh.sshExec.mockResolvedValue(unreachable);

		const file = remoteFile('/home/osm/osm.versatiles');
		await expect(generateHashes([file])).rejects.toThrow(/Could not reach the Storage Box.*Connection timed out/);

		// The failed `cat` must not be read as "sidecar missing".
		expect(ssh.sshExec).not.toHaveBeenCalledWith(['md5sum', '/home/osm/osm.versatiles']);
		expect(ssh.sshExec).not.toHaveBeenCalledWith(['sha256sum', '/home/osm/osm.versatiles']);
		expect(ssh.scpUpload).not.toHaveBeenCalled();
	});

	it('aborts when the connection drops during the staleness check', async () => {
		ssh.sshExec.mockImplementation(async (args: string[]) => {
			if (args[0] === 'cat') return ok(`${args[1].endsWith('.md5') ? MD5 : SHA}  file.versatiles\n`);
			return unreachable;
		});

		const file = remoteFile('/home/osm/osm.versatiles');
		await expect(generateHashes([file])).rejects.toThrow(/Could not reach the Storage Box/);
		expect(ssh.scpUpload).not.toHaveBeenCalled();
	});

	it.each([
		['too short', 'abc123'],
		['not hexadecimal', 'z'.repeat(32)],
		['of the wrong length for its type', 'a'.repeat(40)],
	])('recomputes when the sidecar content is %s', async (_what, content) => {
		ssh.sshExec.mockImplementation(async (args: string[]) => {
			if (args[0] === 'cat') return ok(`${content}  file.versatiles\n`);
			if (args[0] === 'ls') return failed;
			return ok(`${args[0] === 'md5sum' ? MD5 : SHA}  /home/osm/osm.versatiles\n`);
		});
		ssh.scpUpload.mockResolvedValue(true);

		const file = remoteFile('/home/osm/osm.versatiles');
		await generateHashes([file]);

		expect(file.hashes).toEqual({ md5: MD5, sha256: SHA });
		expect(ssh.scpUpload).toHaveBeenCalledTimes(2);
	});

	it('rejects a computed hash that is not a hash', async () => {
		ssh.sshExec.mockImplementation(async (args: string[]) =>
			args[0] === 'cat' ? failed : ok('md5sum: something went wrong'),
		);

		const file = remoteFile('/home/osm/osm.versatiles');
		await expect(generateHashes([file])).rejects.toThrow(/Failed to calculate/);
		expect(ssh.scpUpload).not.toHaveBeenCalled();
	});

	it('gives the quick commands a timeout but not the hash computation', async () => {
		ssh.sshExec.mockImplementation(async (args: string[]) =>
			args[0] === 'cat' ? failed : ok(`${args[0] === 'md5sum' ? MD5 : SHA}  x\n`),
		);
		ssh.scpUpload.mockResolvedValue(true);

		await generateHashes([remoteFile('/home/osm/osm.versatiles')]);

		expect(ssh.sshExec).toHaveBeenCalledWith(['cat', '/home/osm/osm.versatiles.md5'], { timeout: 60000 });
		expect(ssh.sshExec).toHaveBeenCalledWith(['md5sum', '/home/osm/osm.versatiles']);
	});
});
