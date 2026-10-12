/**
 * rclone wrapper — moves `.versatiles` data files from the Hetzner Storage Box
 * (SFTP) to the Cloudflare R2 bucket (S3 API), and generated objects to R2.
 *
 * Node only orchestrates; rclone moves the bytes (multipart, retries). Which
 * files are transferred is decided by `./plan.ts`; this module performs single
 * operations:
 *
 *   /home/osm/osm.20240701.versatiles  ──upload──▶  r2:<bucket>/osm.20240701.versatiles
 *   r2:<bucket>/osm.20240701.versatiles  ──copy──▶  r2:<bucket>/osm.versatiles
 *
 * The stable "latest" key is a copy made inside R2, so the bytes of a release
 * cross the network once, not twice.
 *
 * Every data object carries the **MD5 and SHA256 from the sidecars** as
 * metadata, which is how a later run recognises it. ⚠️ The R2/S3 ETag is
 * deliberately NOT used — for multipart (2 TB) uploads it is not the MD5.
 * After each transfer the object is read back and its size and md5 are checked.
 *
 * The rclone executable, the two remotes and the bucket come from the
 * environment — see `../config.ts`.
 */
import { spawnSync } from 'child_process';
import { FileRef } from '../file/file_ref.js';
import { rcloneConfig as config, type RcloneConfig } from '../config.js';

/**
 * Source path on the SFTP remote. The scan produces absolute `/home/...` paths;
 * rclone SFTP paths are relative to the remote's login directory, so a prefix is
 * stripped (`RCLONE_SFTP_STRIP_PREFIX`, default `/home/`; e.g. `/` if the
 * folders appear under `<remote>:home`).
 */
function sftpSource(cfg: RcloneConfig, remotePath: string): string {
	const prefix = cfg.sftpStripPrefix;
	const rel = remotePath.startsWith(prefix) ? remotePath.slice(prefix.length) : remotePath.replace(/^\/+/, '');
	return `${cfg.sftpRemote}:${rel}`;
}

/** Destination object on the R2 remote. */
function r2Dest(cfg: RcloneConfig, key: string): string {
	return `${cfg.r2Remote}:${cfg.bucket}/${key}`;
}

/** R2 key for a `FileRef` — its `url` without the leading slash. */
function keyOf(file: FileRef): string {
	return file.url.replace(/^\//, '');
}

/**
 * Runs rclone. By default captures stdout/stderr (for small, parseable output);
 * with `inherit` it streams straight to the console (for long-running uploads,
 * so progress is visible and nothing is buffered). `input` is piped to stdin
 * (used by `rcat` to upload generated content without a temp file).
 */
export function runRclone(
	args: string[],
	opts: { inherit?: boolean; input?: string } = {},
): { status: number; stdout: string; stderr: string } {
	const { bin } = config();
	const result = opts.inherit
		? spawnSync(bin, args, { stdio: 'inherit' })
		: spawnSync(bin, args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, input: opts.input });
	return {
		status: result.status ?? 1,
		stdout: result.stdout?.toString() ?? '',
		stderr: result.stderr?.toString() ?? '',
	};
}

/**
 * Uploads generated content to an R2 object via `rclone rcat`, setting the given
 * Content-Type. `url` is the object's path/key (with or without a leading slash).
 *
 * `metadata` adds further object metadata entries. The size indices use it to
 * record the md5 of the data file they describe, so a later run can tell whether
 * a cached index is still current (see `../size_index/sync.ts`).
 *
 * Throws if the upload fails.
 */
export function uploadObject(
	url: string,
	content: string,
	contentType: string,
	metadata: Record<string, string> = {},
): void {
	const cfg = config();
	const key = url.replace(/^\//, '');
	const metadataArgs = Object.entries({ 'content-type': contentType, ...metadata }).flatMap(([k, v]) => [
		'--metadata-set',
		`${k}=${v}`,
	]);
	const result = runRclone(['rcat', '--metadata', ...metadataArgs, r2Dest(cfg, key)], {
		input: content,
	});
	if (result.status !== 0) {
		throw new Error(`rclone failed to upload ${key} (exit ${result.status})`);
	}
}

/**
 * Copies an object to another key within R2, keeping its content type and
 * metadata. `fromUrl` / `toUrl` are object paths, with or without a leading slash.
 *
 * Throws if the copy fails.
 */
export function copyObject(fromUrl: string, toUrl: string): void {
	const cfg = config();
	const fromKey = fromUrl.replace(/^\//, '');
	const toKey = toUrl.replace(/^\//, '');
	const result = runRclone(['copyto', '--metadata', r2Dest(cfg, fromKey), r2Dest(cfg, toKey)]);
	if (result.status !== 0) {
		throw new Error(`rclone failed to copy ${fromKey} to ${toKey} (exit ${result.status})`);
	}
}

/**
 * Uploads a local directory tree to the R2 bucket (optionally under `destPrefix`),
 * transferring only changed files. Used to publish the built static site
 * (`build/` → bucket root: index.html, feeds, `_app/…` assets).
 *
 * Throws if the copy fails.
 */
export function uploadDir(localDir: string, destPrefix = ''): void {
	const cfg = config();
	const dest = destPrefix ? r2Dest(cfg, destPrefix) : `${cfg.r2Remote}:${cfg.bucket}`;
	console.log(`Uploading ${localDir} -> ${dest} ...`);
	const result = runRclone(['copy', localDir, dest, '--progress'], { inherit: true });
	if (result.status !== 0) {
		throw new Error(`rclone failed to upload ${localDir} (exit ${result.status})`);
	}
}

/** What is known about an object on R2. */
export interface RemoteObject {
	/** Size in bytes. */
	size: number;
	/** The `md5` recorded in the object's metadata when it was uploaded, if any. */
	md5: string | null;
	/** The `sha256` recorded in the object's metadata when it was uploaded, if any. */
	sha256: string | null;
}

/**
 * Lists the `.versatiles` data files in the bucket with their size and the
 * checksums recorded in their metadata, keyed by url (`/osm.versatiles`).
 *
 * One listing for the whole bucket, rather than one request per file, so that
 * "not on R2" is a fact read from a complete answer. Asking per file cannot
 * tell a missing object from a failed request — and the planner drops a
 * dataset from the site when it believes the former.
 *
 * Throws if the bucket cannot be listed.
 */
export function listRemoteDataFiles(): Map<string, RemoteObject> {
	const cfg = config();
	const result = runRclone([
		'lsjson',
		'--files-only',
		'--metadata',
		'--include',
		'*.versatiles',
		`${cfg.r2Remote}:${cfg.bucket}`,
	]);
	if (result.status !== 0) {
		const reason = result.stderr.trim().split('\n').pop();
		throw new Error(`rclone failed to list the bucket (exit ${result.status})${reason ? `: ${reason}` : ''}`);
	}

	const entries = JSON.parse(result.stdout) as { Path: string; Size: number; Metadata?: Record<string, string> }[];
	return new Map(
		entries.map((entry) => [
			`/${entry.Path}`,
			{ size: entry.Size, md5: entry.Metadata?.md5 ?? null, sha256: entry.Metadata?.sha256 ?? null },
		]),
	);
}

/**
 * Reads one object's size and recorded checksums, or returns null if it cannot
 * be read. Null does not prove the object is absent — use
 * {@link listRemoteDataFiles} where that distinction matters.
 */
export function remoteObject(key: string): RemoteObject | null {
	const cfg = config();
	const result = runRclone(['lsjson', '--metadata', r2Dest(cfg, key.replace(/^\//, ''))]);
	if (result.status !== 0) return null;
	try {
		const [entry] = JSON.parse(result.stdout) as { Size: number; Metadata?: Record<string, string> }[];
		if (!entry) return null;
		return { size: entry.Size, md5: entry.Metadata?.md5 ?? null, sha256: entry.Metadata?.sha256 ?? null };
	} catch {
		return null;
	}
}

/**
 * Returns the md5 stored in an R2 object's metadata, or null if the object or
 * the metadata entry is absent.
 *
 * This is the change-detection primitive for the generated size indices, which
 * carry the md5 of the data file they describe.
 */
export function remoteMd5(key: string): string | null {
	return remoteObject(key)?.md5 ?? null;
}

/**
 * Uploads a data file from the Storage Box to its key on R2, recording its
 * `md5`, `sha256` and `content-type` as object metadata, and verifies the result.
 *
 * Throws if the upload fails or the object on R2 is not the file afterwards.
 */
export function uploadDataFile(file: FileRef): void {
	const cfg = config();
	const key = keyOf(file);

	console.log(` - Uploading ${key} (${file.sizeString})`);
	const result = runRclone(
		[
			'copyto',
			'--progress',
			'--retries',
			'3',
			'--metadata',
			'--metadata-set',
			`md5=${file.md5}`,
			'--metadata-set',
			`sha256=${file.sha256}`,
			'--metadata-set',
			'content-type=application/octet-stream',
			sftpSource(cfg, file.remotePath),
			r2Dest(cfg, key),
		],
		{ inherit: true },
	);
	if (result.status !== 0) {
		throw new Error(`rclone failed to upload ${key} (exit ${result.status})`);
	}
	verifyDataFile(file);
}

/**
 * Copies a data file that is already on R2 to a second key — the stable
 * "latest" key of a release — without the bytes leaving R2, and verifies the
 * result. `--metadata` carries the checksums and content type over.
 *
 * Throws if the copy fails or the copy is not the file afterwards.
 */
export function copyDataFile(from: FileRef, to: FileRef): void {
	const cfg = config();
	const fromKey = keyOf(from);
	const toKey = keyOf(to);

	console.log(` - Copying ${fromKey} -> ${toKey} within R2 (${to.sizeString})`);
	const result = runRclone(
		['copyto', '--progress', '--retries', '3', '--metadata', r2Dest(cfg, fromKey), r2Dest(cfg, toKey)],
		{ inherit: true },
	);
	if (result.status !== 0) {
		throw new Error(`rclone failed to copy ${fromKey} to ${toKey} (exit ${result.status})`);
	}
	verifyDataFile(to);
}

/**
 * Checks that the object under a file's key has the file's size and md5.
 *
 * The md5 is metadata, so on its own it only shows that the transfer was
 * started for this file; the size is what the bytes on R2 actually amount to.
 */
function verifyDataFile(file: FileRef): void {
	const key = keyOf(file);
	const object = remoteObject(key);
	if (!object) throw new Error(`${key} cannot be read back from R2 after the transfer`);
	if (object.size !== file.size) {
		throw new Error(`${key} has ${object.size} bytes on R2 after the transfer, expected ${file.size}`);
	}
	if (object.md5 !== file.md5) {
		throw new Error(`${key} carries md5 "${object.md5}" on R2 after the transfer, expected "${file.md5}"`);
	}
}
