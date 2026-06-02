/**
 * Discovers `.versatiles` files on the Hetzner Storage Box via SSH.
 *
 * Runs `ls -lR /home` over SSH (compatible with the Storage Box restricted
 * shell) and parses the output into a `FileRef` per `.versatiles` file, with its
 * `remotePath` populated for downstream mirroring (rclone → R2) and hashing.
 *
 * Sidecar files (`.md5` / `.sha256`) are intentionally ignored here — they are
 * handled by `../file/hashes.ts`.
 */
import { FileRef } from '../file/file_ref.js';
import { sshExecSync } from './ssh.js';

/** Default remote root scanned for datasets (override with STORAGE_ROOT). */
const DEFAULT_ROOT = '/home';

/**
 * Scans the Storage Box and returns all `.versatiles` files, sorted by remote path.
 *
 * Only the subtree given by `STORAGE_ROOT` (default `/home`) is scanned, so the
 * mirror can be limited to the download.versatiles.org datasets (e.g. set
 * `STORAGE_ROOT=/home/download`).
 *
 * Throws if the SSH scan command fails.
 */
export function getRemoteFiles(): FileRef[] {
	const root = process.env['STORAGE_ROOT'] ?? DEFAULT_ROOT;
	console.log(`Scanning remote storage (${root}) via SSH...`);

	const result = sshExecSync(['ls', '-lR', root]);
	if (result.status !== 0) {
		throw new Error(`Failed to scan remote storage via SSH: ${result.stderr}`);
	}

	const files: FileRef[] = [];
	let currentDir = root;

	for (const line of result.stdout.trim().split('\n')) {
		// Directory header: "/home/dirname:"
		if (line.endsWith(':')) { currentDir = line.slice(0, -1); continue; }

		// Skip blank lines, "total N" summaries and directory entries.
		if (!line.trim() || line.startsWith('total ')) continue;
		if (line.startsWith('d')) continue;

		// "-rw-r--r-- 1 user group SIZE month day time/year filename"
		const parts = line.trim().split(/\s+/);
		if (parts.length < 9) continue;

		const size = parseInt(parts[4], 10);
		if (isNaN(size)) continue;

		// Filename is everything from field 8 onwards (handles spaces in names).
		const filename = parts.slice(8).join(' ');
		if (!filename.endsWith('.versatiles')) continue;

		// Guard against path traversal / unexpected names.
		if (filename.includes('..') || filename.includes('/')) continue;

		const remotePath = `${currentDir}/${filename}`;
		files.push(new FileRef(remotePath, size, remotePath));
	}

	console.log(` - Found ${files.length} .versatiles files`);
	return files.sort((a, b) => a.fullname.localeCompare(b.fullname));
}
