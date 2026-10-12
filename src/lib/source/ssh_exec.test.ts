import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Separate from `ssh.test.ts`, which exercises the real argument building:
// these tests replace `child_process` to script how ssh exits.
const cp = { spawn: vi.fn(), spawnSync: vi.fn() };
vi.mock('child_process', () => cp);

const { sshExec, sshExecSync, connectionFailed, SSH_CONNECTION_FAILED } = await import('./ssh.js');

interface Exit {
	code?: number | null;
	signal?: string;
	stdout?: string;
	stderr?: string;
	error?: Error;
}

/** Makes the next `spawn` call return a process that ends as described. */
function nextProcess(exit: Exit): void {
	cp.spawn.mockImplementationOnce(() => {
		const proc = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
		queueMicrotask(() => {
			if (exit.error) {
				proc.emit('error', exit.error);
				return;
			}
			if (exit.stdout) proc.stdout.emit('data', Buffer.from(exit.stdout));
			if (exit.stderr) proc.stderr.emit('data', Buffer.from(exit.stderr));
			proc.emit('close', exit.code ?? null, exit.signal ?? null);
		});
		return proc;
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv('STORAGE_URL', 'user@host');
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('sshExec', () => {
	it('returns the output of a successful command', async () => {
		nextProcess({ code: 0, stdout: 'hello\n' });

		expect(await sshExec(['cat', 'file'])).toEqual({ success: true, status: 0, stdout: 'hello', stderr: '' });
		expect(cp.spawn).toHaveBeenCalledTimes(1);
	});

	it('returns a failed remote command without retrying it', async () => {
		nextProcess({ code: 1, stderr: 'cat: file: No such file or directory\n' });

		const result = await sshExec(['cat', 'file']);

		expect(result).toMatchObject({ success: false, status: 1, stderr: 'cat: file: No such file or directory' });
		expect(connectionFailed(result)).toBe(false);
		expect(cp.spawn).toHaveBeenCalledTimes(1);
	});

	it('retries a failed connection and returns the later answer', async () => {
		nextProcess({ code: 255, stderr: 'Connection reset' });
		nextProcess({ code: 0, stdout: 'hello' });

		const result = await sshExec(['cat', 'file'], { retryDelay: 1 });

		expect(result).toMatchObject({ success: true, stdout: 'hello' });
		expect(cp.spawn).toHaveBeenCalledTimes(2);
	});

	it('hands the connection failure back after the last attempt', async () => {
		for (let i = 0; i < 3; i++) nextProcess({ code: 255, stderr: 'Connection timed out' });

		const result = await sshExec(['cat', 'file'], { retryDelay: 1 });

		expect(connectionFailed(result)).toBe(true);
		expect(result.stderr).toBe('Connection timed out');
		expect(cp.spawn).toHaveBeenCalledTimes(3);
	});

	it('treats a process that could not be started as a connection failure', async () => {
		nextProcess({ error: new Error('spawn ssh ENOENT') });

		const result = await sshExec(['cat', 'file'], { attempts: 1 });

		expect(result).toMatchObject({ success: false, status: SSH_CONNECTION_FAILED, stderr: 'spawn ssh ENOENT' });
	});

	it('treats a killed process as a connection failure', async () => {
		nextProcess({ code: null, signal: 'SIGTERM' });

		const result = await sshExec(['cat', 'file'], { attempts: 1, timeout: 5 });

		expect(result).toMatchObject({ status: SSH_CONNECTION_FAILED, stderr: 'terminated by SIGTERM' });
		expect(cp.spawn.mock.calls[0][2]).toEqual({ timeout: 5 });
	});
});

describe('sshExecSync', () => {
	it('returns status and output of the remote command', () => {
		cp.spawnSync.mockReturnValue({ status: 2, stdout: '', stderr: 'ls: cannot access' });

		expect(sshExecSync(['ls'])).toEqual({ success: false, status: 2, stdout: '', stderr: 'ls: cannot access' });
	});

	it('reports a timeout as a connection failure with a reason', () => {
		cp.spawnSync.mockReturnValue({ status: null, signal: 'SIGTERM', error: new Error('spawnSync ssh ETIMEDOUT') });

		const result = sshExecSync(['ls']);

		expect(connectionFailed(result)).toBe(true);
		expect(result.stderr).toBe('spawnSync ssh ETIMEDOUT');
	});
});
