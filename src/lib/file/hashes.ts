/**
 * Hash / sidecar handling for `.versatiles` files on the Storage Box.
 *
 * For every file the updater needs the MD5 and SHA256 checksum. Each is obtained
 * by, in order of preference:
 *   1. downloading the existing `.<type>` sidecar from the Storage Box (the
 *      producing pipeline maintains these), or
 *   2. computing it remotely (`<type>sum`) and uploading the sidecar back so the
 *      next run can simply download it.
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

/** Downloads and parses an existing `.<type>` sidecar. Returns the hash or null. */
async function downloadSidecar(remotePath: string, type: HashType): Promise<string | null> {
	const result = await sshExec(['cat', `${remotePath}.${type}`]);
	if (!result.success || result.stdout.length === 0) return null;
	const hash = result.stdout.split(/\s/)[0];
	return hash && hash.length >= 32 ? hash : null;
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
