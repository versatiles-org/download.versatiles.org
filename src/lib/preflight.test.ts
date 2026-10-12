import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Config } from './config.js';

console.log = vi.fn();

const ssh = { sshExec: vi.fn() };
vi.mock('./source/ssh.js', () => ssh);

const rclone = { runRclone: vi.fn() };
vi.mock('./mirror/rclone.js', () => rclone);

const { preflight } = await import('./preflight.js');

const config: Config = {
	domain: 'example.org',
	dryRun: false,
	ssh: { storageUrl: 'user@host', storageRoot: '/home/download', key: '/keys/id', port: '23' },
	rclone: { bin: 'rclone', sftpRemote: 'hetzner', r2Remote: 'r2', bucket: 'downloads', sftpStripPrefix: '/home/' },
};

const sshOk = { success: true, status: 0, stdout: '', stderr: '' };
const rcloneOk = { status: 0, stdout: '', stderr: '' };

/** Makes rclone fail for the invocations whose arguments contain `needle`. */
function failRclone(needle: string, stderr: string): void {
	rclone.runRclone.mockImplementation((args: string[]) =>
		args.includes(needle) ? { status: 1, stdout: '', stderr } : rcloneOk,
	);
}

describe('preflight', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ssh.sshExec.mockResolvedValue(sshOk);
		rclone.runRclone.mockReturnValue(rcloneOk);
	});

	it('passes when everything is reachable', async () => {
		await expect(preflight(config)).resolves.toBeUndefined();

		expect(ssh.sshExec).toHaveBeenCalledWith(['ls', '/home/download'], { timeout: 60000 });
		expect(rclone.runRclone.mock.calls.map((call) => call[0])).toEqual([
			['version'],
			['lsf', '--max-depth', '1', 'hetzner:'],
			['lsf', '--max-depth', '1', 'r2:downloads'],
		]);
	});

	it('reports an unreachable Storage Box with the reason', async () => {
		ssh.sshExec.mockResolvedValue({
			success: false,
			status: 255,
			stdout: '',
			stderr: 'Permission denied (publickey).',
		});

		await expect(preflight(config)).rejects.toThrow(
			/Storage Box: cannot list \/home\/download over SSH — Permission denied/,
		);
	});

	it('reports a missing rclone executable and skips the remote checks', async () => {
		failRclone('version', '');

		await expect(preflight(config)).rejects.toThrow(/cannot run "rclone"/);
		expect(rclone.runRclone).toHaveBeenCalledTimes(1);
	});

	it('reports a broken SFTP remote', async () => {
		failRclone('hetzner:', 'NOTICE: something\nFailed to create file system: ssh: handshake failed');

		await expect(preflight(config)).rejects.toThrow(/remote "hetzner": .* — Failed to create file system/);
	});

	it('reports a broken R2 remote', async () => {
		failRclone('r2:downloads', '401 Unauthorized');

		await expect(preflight(config)).rejects.toThrow(/remote "r2": cannot list the bucket "downloads" — 401/);
	});

	it('lists every failure in one error', async () => {
		ssh.sshExec.mockResolvedValue({ success: false, status: 255, stdout: '', stderr: 'timeout' });
		failRclone('r2:downloads', '401 Unauthorized');

		const error = await preflight(config).catch((e: Error) => e);

		expect((error as Error).message).toMatch(/Storage Box[\s\S]*remote "r2"/);
	});
});
