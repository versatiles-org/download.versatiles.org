/**
 * Shared SSH/SCP helpers for talking to the Hetzner Storage Box.
 *
 * The Storage Box exposes a restricted shell over SSH on port 23. These helpers
 * centralise the connection options (identity file, batch mode, host-key policy)
 * used by both the remote file scan (`scan.ts`) and the hash/sidecar handling
 * (`../file/hashes.ts`).
 *
 * The Storage Box address, port, identity file and host-key policy come from
 * the environment — see `../config.ts`.
 */
import { spawn, spawnSync } from 'child_process';
import { sshConfig, type SshConfig } from '../config.js';

/**
 * Connection options shared by ssh and scp (the port flag differs, set per call).
 *
 * With a known-hosts file configured the host key must match it; without one, a
 * host key seen for the first time is accepted and remembered.
 */
function commonOptions(cfg: SshConfig): string[] {
	const hostKeyOptions = cfg.knownHosts
		? [`-oUserKnownHostsFile=${cfg.knownHosts}`, '-oStrictHostKeyChecking=yes']
		: ['-oStrictHostKeyChecking=accept-new'];
	return [
		'-i',
		cfg.key,
		// Offer only this key: an agent full of other keys can exhaust the server's
		// authentication attempts before the right one is tried.
		'-oIdentitiesOnly=yes',
		'-oBatchMode=yes',
		'-oConnectTimeout=15',
		// Notice a dead connection within two minutes. Remote hashing of a large
		// file runs for hours without output, so it cannot have a timeout of its own.
		'-oServerAliveInterval=30',
		'-oServerAliveCountMax=4',
		...hostKeyOptions,
	];
}

/** Builds the full ssh argument list for a remote command. */
export function buildSSHArgs(remoteArgs: string[]): string[] {
	const cfg = sshConfig();
	return [cfg.storageUrl, '-p', cfg.port, ...commonOptions(cfg), ...remoteArgs];
}

/**
 * Exit status ssh itself uses when it could not connect, authenticate or keep
 * the connection alive. Any other status is that of the remote command.
 */
export const SSH_CONNECTION_FAILED = 255;

/** Outcome of a remote command. */
export interface SshResult {
	/** True if the remote command ran and exited with status 0. */
	success: boolean;
	/** Exit status of the remote command, or `SSH_CONNECTION_FAILED`. */
	status: number;
	stdout: string;
	stderr: string;
}

/** True if the command never produced a result of its own because ssh failed. */
export function connectionFailed(result: SshResult): boolean {
	return result.status === SSH_CONNECTION_FAILED;
}

/** Runs a remote command synchronously and returns its status, stdout and stderr. */
export function sshExecSync(remoteArgs: string[], timeout = 120000): SshResult {
	const result = spawnSync('ssh', buildSSHArgs(remoteArgs), { encoding: 'utf-8', timeout });
	if (result.error || result.status === null) {
		// Could not be started, timed out or was killed — none of which is an
		// answer from the remote command.
		const reason = result.error?.message ?? `terminated by ${result.signal ?? 'a signal'}`;
		return { success: false, status: SSH_CONNECTION_FAILED, stdout: result.stdout ?? '', stderr: reason };
	}
	return {
		success: result.status === 0,
		status: result.status,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
	};
}

/** Options for {@link sshExec}. */
export interface SshExecOptions {
	/** Kill the command after this many milliseconds. Default: no limit. */
	timeout?: number;
	/** Attempts made while the connection keeps failing. Default 3. */
	attempts?: number;
	/** Delay before the second attempt, doubled for each further one. Default 2000 ms. */
	retryDelay?: number;
}

/**
 * Runs a remote command asynchronously.
 *
 * A failed *connection* is retried, because it says nothing about the remote
 * command; a command that ran and failed is returned as is. Callers must still
 * check {@link connectionFailed}: after the last attempt the failure is handed
 * back, and it must not be mistaken for an answer such as "file not found".
 */
export async function sshExec(remoteArgs: string[], options: SshExecOptions = {}): Promise<SshResult> {
	const { timeout, attempts = 3, retryDelay = 2000 } = options;
	const args = buildSSHArgs(remoteArgs);

	for (let attempt = 1; ; attempt++) {
		const result = await spawnSSH(args, timeout);
		if (!connectionFailed(result) || attempt >= attempts) return result;
		await new Promise((resolve) => setTimeout(resolve, retryDelay * 2 ** (attempt - 1)));
	}
}

/** Runs ssh once and collects its output. */
function spawnSSH(args: string[], timeout?: number): Promise<SshResult> {
	return new Promise((resolve) => {
		const proc = spawn('ssh', args, { timeout });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		proc.stdout.on('data', (d: Buffer) => stdout.push(d));
		proc.stderr.on('data', (d: Buffer) => stderr.push(d));
		proc.on('error', (error) =>
			resolve({ success: false, status: SSH_CONNECTION_FAILED, stdout: '', stderr: error.message }),
		);
		proc.on('close', (code, signal) => {
			const out = Buffer.concat(stdout).toString().trim();
			const err = Buffer.concat(stderr).toString().trim();
			if (code === null) {
				// Killed: by the timeout above, or from outside.
				resolve({
					success: false,
					status: SSH_CONNECTION_FAILED,
					stdout: out,
					stderr: err || `terminated by ${signal ?? 'a signal'}`,
				});
			} else {
				resolve({ success: code === 0, status: code, stdout: out, stderr: err });
			}
		});
	});
}

/** Uploads a local file to the Storage Box via scp. Resolves true on success. */
export function scpUpload(localPath: string, remotePath: string): Promise<boolean> {
	const cfg = sshConfig();
	const args = ['-P', cfg.port, ...commonOptions(cfg), localPath, `${cfg.storageUrl}:${remotePath}`];
	return new Promise((resolve) => {
		const proc = spawn('scp', args);
		proc.on('error', () => resolve(false));
		proc.on('close', (code) => resolve(code === 0));
	});
}
