/**
 * Shared SSH/SCP helpers for talking to the Hetzner Storage Box.
 *
 * The Storage Box exposes a restricted shell over SSH on port 23. These helpers
 * centralise the connection options (identity file, batch mode, host-key policy)
 * used by both the remote file scan (`scan.ts`) and the hash/sidecar handling
 * (`../file/hashes.ts`).
 *
 * Configuration via environment:
 * - `STORAGE_URL` — `user@host` of the Storage Box (required).
 * - `SSH_KEY` — path to the identity file (default `.ssh/storage`).
 */
import { spawn, spawnSync } from 'child_process';
import { homedir } from 'os';
import { join, resolve } from 'path';

/** SSH port of the Hetzner Storage Box. */
const SSH_PORT = '23';

/**
 * Resolves the SSH key path to an absolute path, expanding a leading `~` or
 * `$HOME` (env files pass these literally — neither Node nor ssh expand them).
 */
function resolveKeyPath(p: string): string {
	let out = p;
	if (out === '~') out = homedir();
	else if (out.startsWith('~/')) out = join(homedir(), out.slice(2));
	else if (out.startsWith('$HOME/')) out = join(homedir(), out.slice('$HOME/'.length));
	return resolve(out);
}

/** Path to the SSH identity file (absolute). */
const SSH_KEY = resolveKeyPath(process.env['SSH_KEY'] ?? '.ssh/storage');

/** Connection options shared by ssh and scp (the port flag differs, set per call). */
const SSH_COMMON_OPTIONS = ['-i', SSH_KEY, '-oBatchMode=yes', '-oStrictHostKeyChecking=accept-new'];

/** Resolves `STORAGE_URL` or throws if it is missing. */
function storageUrl(): string {
	const url = process.env['STORAGE_URL'];
	if (!url) throw new Error('STORAGE_URL environment variable is not set');
	return url;
}

/** Builds the full ssh argument list for a remote command. */
export function buildSSHArgs(remoteArgs: string[]): string[] {
	return [storageUrl(), '-p', SSH_PORT, ...SSH_COMMON_OPTIONS, ...remoteArgs];
}

/** Runs a remote command synchronously and returns its status, stdout and stderr. */
export function sshExecSync(
	remoteArgs: string[],
	timeout = 120000,
): { status: number; stdout: string; stderr: string } {
	const result = spawnSync('ssh', buildSSHArgs(remoteArgs), { encoding: 'utf-8', timeout });
	return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Runs a remote command asynchronously; resolves with a success flag and stdout. */
export function sshExec(remoteArgs: string[]): Promise<{ success: boolean; stdout: string }> {
	const args = buildSSHArgs(remoteArgs);
	return new Promise((resolve) => {
		const proc = spawn('ssh', args);
		const chunks: Buffer[] = [];
		proc.stdout.on('data', (d: Buffer) => chunks.push(d));
		proc.stderr.on('data', () => {
			/* ignore */
		});
		proc.on('error', () => resolve({ success: false, stdout: '' }));
		proc.on('close', (code) => resolve({ success: code === 0, stdout: Buffer.concat(chunks).toString().trim() }));
	});
}

/** Uploads a local file to the Storage Box via scp. Resolves true on success. */
export function scpUpload(localPath: string, remotePath: string): Promise<boolean> {
	const args = ['-P', SSH_PORT, ...SSH_COMMON_OPTIONS, localPath, `${storageUrl()}:${remotePath}`];
	return new Promise((resolve) => {
		const proc = spawn('scp', args);
		proc.on('error', () => resolve(false));
		proc.on('close', (code) => resolve(code === 0));
	});
}
