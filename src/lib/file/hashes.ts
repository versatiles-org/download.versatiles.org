/**
 * Hash / sidecar handling for `.versatiles` files on the Storage Box.
 *
 * For every file the updater needs the MD5 and SHA256 checksum. Each is obtained
 * by, in order of preference:
 *   1. downloading the existing `.<type>` sidecar from the Storage Box (the
 *      producing pipeline maintains these) — **only if it is up to date**, or
 *   2. computing it remotely (`<type>sum`) and uploading the sidecar back so the
 *      next run can simply download it.
 *
 * A sidecar that is **older than its data file** is treated as stale (the file
 * was overwritten without refreshing the sidecar) and recomputed, so a changed
 * file is never mirrored with an outdated hash.
 *
 * Downloads are cheap and run with limited parallelism; remote computation is
 * heavy (reads the whole multi-GB file) and runs strictly one at a time.
 *
 * ⚠️ Never use the R2/S3 ETag as the hash — for multipart uploads it is not the
 * MD5. The checksums always come from these sidecars.
 */
import { basename, join } from 'path';
import { tmpdir } from 'os';
import { writeFileSync, unlinkSync } from 'fs';
import { FileRef } from './file_ref.js';
import { sshExec, scpUpload } from '../source/ssh.js';

/** Maximum number of concurrent sidecar downloads (lightweight). */
const DOWNLOAD_CONCURRENCY = 8;

/** Maximum number of concurrent remote hash computations (heavy — keep at 1). */
const COMPUTE_CONCURRENCY = 1;

type HashType = 'md5' | 'sha256';

interface HashTask {
	file: FileRef;
	type: HashType;
}

/**
 * Populates `file.hashes = { md5, sha256 }` for every file, downloading existing
 * sidecars where possible and computing (then uploading) the rest.
 *
 * Throws if a hash can neither be downloaded nor computed.
 */
export async function generateHashes(files: FileRef[]) {
	console.log('Fetching hashes from remote storage...');

	const stats = { downloaded: 0, calculated: 0 };
	/** Map of `${remotePath}.${type}` -> hash value. */
	const hashes = new Map<string, string>();
	const key = (t: HashTask): string => `${t.file.remotePath}.${t.type}`;

	const tasks: HashTask[] = [];
	for (const file of files) {
		for (const type of ['md5', 'sha256'] as HashType[]) tasks.push({ file, type });
	}

	// Phase 1: download existing sidecars in parallel (lightweight).
	const needsCompute: HashTask[] = [];
	await runWithConcurrency(
		tasks.map((t) => async () => {
			const hash = await downloadSidecar(t.file.remotePath, t.type);
			if (hash) {
				hashes.set(key(t), hash);
				stats.downloaded++;
			} else {
				needsCompute.push(t);
			}
		}),
		DOWNLOAD_CONCURRENCY,
	);

	// Phase 2: compute missing hashes remotely, one at a time (heavy).
	await runWithConcurrency(
		needsCompute.map((t) => async () => {
			hashes.set(key(t), await computeSidecar(t.file.remotePath, t.type));
			stats.calculated++;
		}),
		COMPUTE_CONCURRENCY,
	);

	console.log(` - ${stats.downloaded} downloaded, ${stats.calculated} calculated`);

	for (const file of files) {
		file.hashes = {
			md5: get(file, 'md5'),
			sha256: get(file, 'sha256'),
		};
	}

	function get(file: FileRef, type: HashType): string {
		const hash = hashes.get(`${file.remotePath}.${type}`);
		if (!hash) throw new Error(`Missing ${type} hash for "${file.filename}"`);
		return hash;
	}
}

/**
 * Reads an existing `.<type>` sidecar and returns its hash — but only if the
 * sidecar is present, well-formed, and **not older than the data file**. Returns
 * null (→ recompute) if it is missing, malformed, or stale.
 */
async function downloadSidecar(remotePath: string, type: HashType): Promise<string | null> {
	const sidecar = `${remotePath}.${type}`;
	const result = await sshExec(['cat', sidecar]);
	if (!result.success || result.stdout.length === 0) return null;
	const hash = result.stdout.split(/\s/)[0];
	if (!hash || hash.length < 32) return null;

	if (await sidecarIsStale(remotePath, sidecar)) {
		console.log(` - Sidecar ${basename(sidecar)} is older than its data file; recomputing.`);
		return null;
	}
	return hash;
}

/**
 * Best-effort staleness check: true if the sidecar's mtime is older than the
 * data file's. Uses `ls --time-style=+%s` for epoch mtimes; if it can't be
 * determined (e.g. the option is unsupported), assumes fresh so we never force a
 * needless full recompute of every file.
 */
async function sidecarIsStale(dataPath: string, sidecarPath: string): Promise<boolean> {
	const ls = await sshExec(['ls', '-l', '--time-style=+%s', dataPath, sidecarPath]);
	if (!ls.success) return false;
	const dataMtime = mtimeFromLs(ls.stdout, dataPath);
	const sideMtime = mtimeFromLs(ls.stdout, sidecarPath);
	if (dataMtime === null || sideMtime === null) return false;
	return sideMtime < dataMtime;
}

/** Extracts the epoch mtime for `path` from `ls -l --time-style=+%s` output. */
function mtimeFromLs(output: string, path: string): number | null {
	for (const line of output.split('\n')) {
		const parts = line.trim().split(/\s+/);
		if (parts.length < 2 || parts[parts.length - 1] !== path) continue;
		const mtime = Number(parts[parts.length - 2]);
		return Number.isFinite(mtime) ? mtime : null;
	}
	return null;
}

/** Computes a hash remotely, uploads the sidecar back, and returns the hash. */
async function computeSidecar(remotePath: string, type: HashType): Promise<string> {
	console.log(` - Calculating ${type} for ${basename(remotePath)} on remote...`);
	const result = await sshExec([`${type}sum`, remotePath]);
	const hash = result.success ? result.stdout.split(/\s/)[0] : '';
	if (!hash || hash.length < 32) throw new Error(`Failed to calculate ${type} for ${remotePath}`);

	// Persist the sidecar back to the Storage Box for future runs.
	const tmpFile = join(tmpdir(), `hash-${basename(remotePath)}.${type}`);
	writeFileSync(tmpFile, `${hash}  ${basename(remotePath)}\n`);
	try {
		const ok = await scpUpload(tmpFile, `${remotePath}.${type}`);
		if (!ok) throw new Error(`Failed to upload ${type} sidecar for ${basename(remotePath)}`);
	} finally {
		unlinkSync(tmpFile);
	}
	return hash;
}

/** Runs async task thunks with a maximum concurrency. */
async function runWithConcurrency(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
	let index = 0;
	async function worker(): Promise<void> {
		while (index < tasks.length) await tasks[index++]();
	}
	await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
}
