/**
 * Discovers `.versatiles` files on the Hetzner Storage Box via SSH.
 *
 * Runs a single `ls -lR` over SSH (compatible with the Storage Box restricted
 * shell) and parses the output into one `ScannedFile` per `.versatiles` file:
 * a `FileRef` with its `remotePath` populated for downstream mirroring
 * (rclone → R2), plus what the listing says about the file's `.md5` / `.sha256`
 * sidecars — whether each exists and when it was last modified.
 *
 * That is everything `../file/hashes.ts` needs to decide which sidecars can be
 * used as they are, so it does not have to ask the Storage Box about each one.
 */
import { FileRef } from '../file/file_ref.js';
import { sshConfig } from '../config.js';
import { connectionFailed, sshExecSync } from './ssh.js';

/** Checksum types kept as sidecars next to each data file. */
export type HashType = 'md5' | 'sha256';

export const HASH_TYPES: readonly HashType[] = ['md5', 'sha256'];

/** A sidecar found next to a data file. */
export interface ScannedSidecar {
	/** Modification time in epoch seconds, or null if the listing has no usable timestamps. */
	mtime: number | null;
}

/** A `.versatiles` file on the Storage Box together with its sidecars. */
export interface ScannedFile {
	file: FileRef;
	/** Modification time in epoch seconds, or null if the listing has no usable timestamps. */
	mtime: number | null;
	/** The sidecars that exist; a missing key means there is no such sidecar. */
	sidecars: Partial<Record<HashType, ScannedSidecar>>;
}

/** Time allowed for the listing. */
const SCAN_TIMEOUT = 120000;

/** One regular file of the listing. */
interface Entry {
	size: number;
	mtime: number | null;
}

/**
 * Scans the Storage Box and returns all `.versatiles` files, sorted by remote path.
 *
 * Only the subtree given by `STORAGE_ROOT` (default `/home`) is scanned, so the
 * mirror can be limited to the download.versatiles.org datasets (e.g. set
 * `STORAGE_ROOT=/home/download`).
 *
 * Throws if the SSH scan command fails.
 */
export function getRemoteFiles(): ScannedFile[] {
	const root = sshConfig().storageRoot;
	console.log(`Scanning remote storage (${root}) via SSH...`);

	const directories = parseListing(list(root), root);

	const files: ScannedFile[] = [];
	for (const [dir, entries] of directories) {
		for (const [name, entry] of entries) {
			if (!name.endsWith('.versatiles')) continue;

			// Guard against path traversal / unexpected names.
			if (name.includes('..') || name.includes('/')) continue;

			const remotePath = `${dir}/${name}`;
			const sidecars: ScannedFile['sidecars'] = {};
			for (const type of HASH_TYPES) {
				const sidecar = entries.get(`${name}.${type}`);
				if (sidecar) sidecars[type] = { mtime: sidecar.mtime };
			}
			files.push({ file: new FileRef(remotePath, entry.size, remotePath), mtime: entry.mtime, sidecars });
		}
	}

	console.log(` - Found ${files.length} .versatiles files`);
	return files.sort((a, b) => a.file.fullname.localeCompare(b.file.fullname));
}

/**
 * Lists `root` recursively, with modification times as epoch seconds where the
 * Storage Box supports it.
 */
function list(root: string): { stdout: string; epoch: boolean } {
	const withEpoch = sshExecSync(['ls', '-lR', '--time-style=+%s', root], SCAN_TIMEOUT);
	if (withEpoch.success) return { stdout: withEpoch.stdout, epoch: true };
	if (connectionFailed(withEpoch)) throw scanError(withEpoch.stderr);

	// `ls` itself failed. That may be the `--time-style` option, so try without
	// it; if the cause is something else (e.g. a wrong root) this fails too.
	const plain = sshExecSync(['ls', '-lR', root], SCAN_TIMEOUT);
	if (!plain.success) throw scanError(plain.stderr || withEpoch.stderr);

	console.log(
		' - The Storage Box does not report exact modification times; sidecars older than their data file cannot be detected.',
	);
	return { stdout: plain.stdout, epoch: false };
}

function scanError(stderr: string): Error {
	return new Error(`Failed to scan remote storage via SSH: ${stderr}`);
}

/**
 * Parses `ls -lR` output into the regular files of each directory.
 *
 * With `--time-style=+%s` a line reads
 *   `-rw-r--r-- 1 user group SIZE EPOCH filename`
 * and without it
 *   `-rw-r--r-- 1 user group SIZE month day time/year filename`.
 */
function parseListing(listing: { stdout: string; epoch: boolean }, root: string): Map<string, Map<string, Entry>> {
	const nameIndex = listing.epoch ? 6 : 8;
	const directories = new Map<string, Map<string, Entry>>();
	let currentDir = root;

	for (const line of listing.stdout.trim().split('\n')) {
		// Directory header: "/home/dirname:"
		if (line.endsWith(':')) {
			currentDir = line.slice(0, -1);
			continue;
		}

		// Regular files only: skips blank lines, "total N" summaries, directories
		// and symlinks (whose name field reads "link -> target").
		if (!line.startsWith('-')) continue;

		const parts = line.trim().split(/\s+/);
		if (parts.length <= nameIndex) continue;

		const size = parseInt(parts[4], 10);
		if (isNaN(size)) continue;

		const mtime = listing.epoch ? Number(parts[5]) : NaN;

		// Filename is everything from the name field onwards (handles spaces in names).
		const name = parts.slice(nameIndex).join(' ');

		let entries = directories.get(currentDir);
		if (!entries) directories.set(currentDir, (entries = new Map()));
		entries.set(name, { size, mtime: Number.isFinite(mtime) ? mtime : null });
	}

	return directories;
}
