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
 * Which sidecars exist, and how old they are, is already known from the scan
 * (`../source/scan.ts`), so the Storage Box is only contacted to read a sidecar
 * that is going to be used or to compute one that is not.
 *
 * A sidecar that is **older than its data file** is treated as stale (the file
 * was overwritten without refreshing the sidecar) and recomputed, so a changed
 * file is never mirrored with an outdated hash.
 *
 * Only an answer from the Storage Box counts: "no such sidecar" leads to a
 * recompute, but a failed connection aborts the run. Otherwise a network blip
 * would start hashing — and then overwrite the sidecar of — a file of up to
 * 1.7 TB.
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
import { sshExec, scpUpload, connectionFailed, type SshResult } from '../source/ssh.js';
import { HASH_TYPES, type HashType, type ScannedFile } from '../source/scan.js';

/** Maximum number of concurrent sidecar downloads (lightweight). */
const DOWNLOAD_CONCURRENCY = 8;

/** Maximum number of concurrent remote hash computations (heavy — keep at 1). */
const COMPUTE_CONCURRENCY = 1;

interface HashTask {
	scanned: ScannedFile;
	type: HashType;
}

/** Shape of a valid hash, by type. */
const HASH_PATTERN: Record<HashType, RegExp> = {
	md5: /^[0-9a-f]{32}$/,
	sha256: /^[0-9a-f]{64}$/,
};

/** Time allowed for reading a sidecar. */
const QUICK_TIMEOUT = 60000;

/**
 * Returns the hash at the start of `<type>sum` output or a sidecar
 * (`<hash>  <filename>`), or null if it does not look like one.
 */
function parseHash(output: string, type: HashType): string | null {
	const hash = output.split(/\s/)[0].toLowerCase();
	return HASH_PATTERN[type].test(hash) ? hash : null;
}

/** Throws if ssh could not reach the Storage Box, so the failure is never read as an answer. */
function assertReachable(result: SshResult, what: string): void {
	if (connectionFailed(result)) {
		throw new Error(`Could not reach the Storage Box while ${what}: ${result.stderr || 'no error output'}`);
	}
}

/**
 * Populates `file.hashes = { md5, sha256 }` for every scanned file, downloading
 * existing sidecars where possible and computing (then uploading) the rest.
 *
 * Throws if a hash can neither be downloaded nor computed, or if the Storage
 * Box cannot be reached.
 */
export async function generateHashes(files: ScannedFile[]) {
	console.log('Fetching hashes from remote storage...');

	const stats = { downloaded: 0, calculated: 0 };
	/** Map of `${remotePath}.${type}` -> hash value. */
	const hashes = new Map<string, string>();
	const key = (t: HashTask): string => `${t.scanned.file.remotePath}.${t.type}`;

	const tasks: HashTask[] = [];
	for (const scanned of files) {
		for (const type of HASH_TYPES) tasks.push({ scanned, type });
	}

	// Phase 1: download existing sidecars in parallel (lightweight).
	const needsCompute: HashTask[] = [];
	await runWithConcurrency(
		tasks.map((t) => async () => {
			const hash = await downloadSidecar(t.scanned, t.type);
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
			hashes.set(key(t), await computeSidecar(t.scanned.file.remotePath, t.type));
			stats.calculated++;
		}),
		COMPUTE_CONCURRENCY,
	);

	console.log(` - ${stats.downloaded} downloaded, ${stats.calculated} calculated`);

	for (const { file } of files) {
		file.hashes = {
			md5: get(file.remotePath, file.filename, 'md5'),
			sha256: get(file.remotePath, file.filename, 'sha256'),
		};
	}

	function get(remotePath: string, filename: string, type: HashType): string {
		const hash = hashes.get(`${remotePath}.${type}`);
		if (!hash) throw new Error(`Missing ${type} hash for "${filename}"`);
		return hash;
	}
}

/**
 * Returns the hash from a file's existing `.<type>` sidecar — but only if the
 * scan found one, it is **not older than the data file**, and its content is
 * well-formed. Returns null (→ recompute) otherwise.
 *
 * If the scan could not determine modification times, a sidecar is assumed to
 * be fresh, so that not every file is needlessly recomputed in full.
 *
 * Throws if the Storage Box could not be reached.
 */
async function downloadSidecar(scanned: ScannedFile, type: HashType): Promise<string | null> {
	const found = scanned.sidecars[type];
	if (!found) return null;

	const sidecar = `${scanned.file.remotePath}.${type}`;
	if (found.mtime !== null && scanned.mtime !== null && found.mtime < scanned.mtime) {
		console.log(` - Sidecar ${basename(sidecar)} is older than its data file; recomputing.`);
		return null;
	}

	const result = await sshExec(['cat', sidecar], { timeout: QUICK_TIMEOUT });
	assertReachable(result, `reading ${basename(sidecar)}`);
	// Listed by the scan but gone by now: treat like any other missing sidecar.
	if (!result.success) return null;

	const hash = parseHash(result.stdout, type);
	if (!hash) console.log(` - Sidecar ${basename(sidecar)} is malformed; recomputing.`);
	return hash;
}

/** Computes a hash remotely, uploads the sidecar back, and returns the hash. */
async function computeSidecar(remotePath: string, type: HashType): Promise<string> {
	console.log(` - Calculating ${type} for ${basename(remotePath)} on remote...`);
	// No timeout: this reads the whole file and can run for hours.
	const result = await sshExec([`${type}sum`, remotePath]);
	assertReachable(result, `calculating ${type} for ${basename(remotePath)}`);
	const hash = result.success ? parseHash(result.stdout, type) : null;
	if (!hash) {
		throw new Error(`Failed to calculate ${type} for ${remotePath}${result.stderr ? `: ${result.stderr}` : ''}`);
	}

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
