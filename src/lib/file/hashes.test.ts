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

describe('generateHashes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('uses existing sidecars when present', async () => {
		ssh.sshExec.mockImplementation(async (args: string[]) => {
			const hash = args[1].endsWith('.md5') ? MD5 : SHA;
			return { success: true, stdout: `${hash}  file.versatiles\n` };
		});

		const file = remoteFile('/home/osm/osm.versatiles');
		await generateHashes([file]);

		expect(file.hashes?.md5).toBe(MD5);
		expect(file.hashes?.sha256).toBe(SHA);
		// Existing sidecars: should fetch via `cat`, never compute or upload.
		expect(ssh.sshExec).toHaveBeenCalledTimes(2);
		expect(ssh.sshExec).toHaveBeenCalledWith(['cat', '/home/osm/osm.versatiles.md5']);
		expect(ssh.sshExec).toHaveBeenCalledWith(['cat', '/home/osm/osm.versatiles.sha256']);
		expect(ssh.scpUpload).not.toHaveBeenCalled();
		expect(writeFileSync).not.toHaveBeenCalled();
	});

	it('computes and uploads sidecars when missing', async () => {
		ssh.sshExec.mockImplementation(async (args: string[]) => {
			if (args[0] === 'cat') return { success: false, stdout: '' };
			const type = args[0].replace('sum', '');
			const hash = type === 'md5' ? MD5 : SHA;
			return { success: true, stdout: `${hash}  /home/osm/osm.versatiles\n` };
		});
		ssh.scpUpload.mockResolvedValue(true);

		const file = remoteFile('/home/osm/osm.versatiles');
		await generateHashes([file]);

		expect(file.hashes?.md5).toBe(MD5);
		expect(file.hashes?.sha256).toBe(SHA);
		// 2 failed downloads + 2 computations.
		expect(ssh.sshExec).toHaveBeenCalledWith(['md5sum', '/home/osm/osm.versatiles']);
		expect(ssh.sshExec).toHaveBeenCalledWith(['sha256sum', '/home/osm/osm.versatiles']);
		expect(ssh.scpUpload).toHaveBeenCalledTimes(2);
		expect(writeFileSync).toHaveBeenCalledTimes(2);
		expect(unlinkSync).toHaveBeenCalledTimes(2);
	});

	it('throws when a hash can neither be downloaded nor computed', async () => {
		ssh.sshExec.mockResolvedValue({ success: false, stdout: '' });

		const file = remoteFile('/home/osm/osm.versatiles');
		await expect(generateHashes([file])).rejects.toThrow(/Failed to calculate/);
	});
});
