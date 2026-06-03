import { describe, it, expect, beforeEach, vi } from 'vitest';

console.log = vi.fn();

const ssh = {
	sshExec: vi.fn(),
	scpUpload: vi.fn(),
};
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
				return { success: true, stdout: `${hash}  file.versatiles\n` };
			}
			if (args[0] === 'ls') {
				const data = args[3];
				const sidecar = args[4];
				// sidecar (2000) newer than data (1000) → fresh
				return { success: true, stdout: `${lsLine(data, 1000)}\n${lsLine(sidecar, 2000)}` };
			}
			return { success: false, stdout: '' };
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
			if (args[0] === 'cat') return { success: false, stdout: '' };
			if (args[0] === 'ls') return { success: false, stdout: '' };
			const type = args[0].replace('sum', '');
			return { success: true, stdout: `${type === 'md5' ? MD5 : SHA}  /home/osm/osm.versatiles\n` };
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
				return { success: true, stdout: `${hash}  file.versatiles\n` };
			}
			if (args[0] === 'ls') {
				const data = args[3];
				const sidecar = args[4];
				// data (2000) newer than sidecar (1000) → stale → recompute
				return { success: true, stdout: `${lsLine(data, 2000)}\n${lsLine(sidecar, 1000)}` };
			}
			const type = args[0].replace('sum', '');
			return { success: true, stdout: `${type === 'md5' ? MD5 : SHA}  /home/osm/osm.versatiles\n` };
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
		ssh.sshExec.mockResolvedValue({ success: false, stdout: '' });

		const file = remoteFile('/home/osm/osm.versatiles');
		await expect(generateHashes([file])).rejects.toThrow(/Failed to calculate/);
	});
});
