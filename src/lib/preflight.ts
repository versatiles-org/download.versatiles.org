/**
 * Checks, before any work starts, that everything the pipeline depends on is
 * reachable: the Storage Box over SSH, the rclone executable and both rclone
 * remotes.
 *
 * Without this a broken R2 token is only noticed after the Storage Box has been
 * scanned and hashed, and a broken rclone SFTP remote — which authenticates
 * separately from the `ssh` calls — only at the first upload.
 */
import type { Config } from './config.js';
import { runRclone } from './mirror/rclone.js';
import { sshExec } from './source/ssh.js';

/** Time allowed for the SSH check. */
const SSH_TIMEOUT = 60000;

/**
 * Runs all checks and throws a single error listing every one that failed.
 */
export async function preflight(config: Config): Promise<void> {
	console.log('Checking connections...');
	const problems: string[] = [];

	const ssh = await sshExec(['ls', config.ssh.storageRoot], { timeout: SSH_TIMEOUT });
	if (!ssh.success) {
		problems.push(`Storage Box: cannot list ${config.ssh.storageRoot} over SSH${reason(ssh.stderr)}`);
	}

	const { bin, sftpRemote, r2Remote, bucket } = config.rclone;
	if (runRclone(['version']).status !== 0) {
		// Without the executable the remote checks below would only repeat this.
		problems.push(`rclone: cannot run "${bin}" (is it installed? see RCLONE_BIN)`);
	} else {
		const sftp = runRclone(['lsf', '--max-depth', '1', `${sftpRemote}:`]);
		if (sftp.status !== 0) {
			problems.push(`rclone remote "${sftpRemote}": cannot list the Storage Box${reason(sftp.stderr)}`);
		}

		const r2 = runRclone(['lsf', '--max-depth', '1', `${r2Remote}:${bucket}`]);
		if (r2.status !== 0) {
			problems.push(`rclone remote "${r2Remote}": cannot list the bucket "${bucket}"${reason(r2.stderr)}`);
		}
	}

	if (problems.length > 0) {
		throw new Error(`Preflight failed (run \`npm run setup\` to configure rclone):\n${bulleted(problems)}`);
	}
}

/** The last line of a command's error output, as a suffix for a message. */
function reason(stderr: string): string {
	const line = stderr.trim().split('\n').pop();
	return line ? ` — ${line}` : '';
}

function bulleted(lines: string[]): string {
	return lines.map((line) => ` - ${line}`).join('\n');
}
