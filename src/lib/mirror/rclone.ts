/**
 * rclone wrapper — mirrors `.versatiles` data files from the Hetzner Storage Box
 * (SFTP) to the Cloudflare R2 bucket (S3 API).
 *
 * Node only orchestrates; rclone moves the bytes (multipart, retries, resume).
 * Files are uploaded one at a time to their flat R2 key (the `FileRef.url`):
 *
 *   /home/osm/osm.20240701.versatiles  ──▶  r2:<bucket>/osm.20240701.versatiles
 *   (same source, stable "latest" key)  ──▶  r2:<bucket>/osm.versatiles
 *
 * Change detection uses the **MD5 from the sidecar** (`FileRef.md5`), stored as
 * R2 object metadata on upload and read back via `rclone lsjson --metadata`.
 * ⚠️ The R2/S3 ETag is deliberately NOT used — for multipart (2 TB) uploads it is
 * not the MD5.
 *
 * Scope: this module mirrors **data files only**. The `.md5`/`.sha256` sidecars,
 * the HTML and the RSS feeds are generated and uploaded as the site assets in a
 * later phase (so their content carries the correct, possibly date-stripped key
 * name rather than the dated source name).
 *
 * Configuration via environment:
 * - `RCLONE_BIN` — rclone executable (default `rclone`).
 * - `RCLONE_SFTP_REMOTE` — name of the configured SFTP remote (Storage Box).
 * - `RCLONE_R2_REMOTE` — name of the configured S3 remote (R2).
 * - `R2_BUCKET` — target bucket name.
 */
import { spawnSync } from 'child_process';
import { FileRef } from '../file/file_ref.js';

/** rclone executable. */
const RCLONE_BIN = process.env['RCLONE_BIN'] ?? 'rclone';

interface RcloneConfig {
	/** Name of the configured SFTP remote (source). */
	sftpRemote: string;
	/** Name of the configured S3/R2 remote (destination). */
	r2Remote: string;
	/** Target bucket. */
	bucket: string;
}

/** Resolves the rclone remote configuration from the environment, or throws. */
function config(): RcloneConfig {
	const sftpRemote = process.env['RCLONE_SFTP_REMOTE'];
	const r2Remote = process.env['RCLONE_R2_REMOTE'];
	const bucket = process.env['R2_BUCKET'];
	if (!sftpRemote) throw new Error('RCLONE_SFTP_REMOTE environment variable is not set');
	if (!r2Remote) throw new Error('RCLONE_R2_REMOTE environment variable is not set');
	if (!bucket) throw new Error('R2_BUCKET environment variable is not set');
	return { sftpRemote, r2Remote, bucket };
}

/**
 * Source path on the SFTP remote. The Storage Box home is `/home`, and the scan
 * produces absolute `/home/...` paths; rclone SFTP paths are relative to the
 * remote root, so the `/home/` prefix is stripped.
 */
function sftpSource(cfg: RcloneConfig, remotePath: string): string {
	return `${cfg.sftpRemote}:${remotePath.replace(/^\/home\//, '')}`;
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
export function runRclone(args: string[], opts: { inherit?: boolean; input?: string } = {}): { status: number; stdout: string; stderr: string } {
	const result = opts.inherit
		? spawnSync(RCLONE_BIN, args, { stdio: 'inherit' })
		: spawnSync(RCLONE_BIN, args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, input: opts.input });
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
 * Throws if the upload fails.
 */
export function uploadObject(url: string, content: string, contentType: string): void {
	const cfg = config();
	const key = url.replace(/^\//, '');
	const result = runRclone([
		'rcat',
		'--metadata',
		'--metadata-set', `content-type=${contentType}`,
		r2Dest(cfg, key),
	], { input: content });
	if (result.status !== 0) {
		throw new Error(`rclone failed to upload ${key} (exit ${result.status})`);
	}
}

/** Returns the md5 stored in an R2 object's metadata, or null if absent/missing. */
function remoteMd5(cfg: RcloneConfig, key: string): string | null {
	const result = runRclone(['lsjson', '--metadata', r2Dest(cfg, key)]);
	if (result.status !== 0) return null;
	try {
		const entries = JSON.parse(result.stdout) as { Metadata?: Record<string, string> }[];
		return entries[0]?.Metadata?.md5 ?? null;
	} catch {
		return null;
	}
}

/** Result of a mirror run. */
export interface MirrorStats {
	/** Number of files transferred. */
	uploaded: number;
	/** Number of files already current on R2 (skipped). */
	skipped: number;
}

/**
 * Mirrors the given data files to R2, skipping any whose R2 object already
 * carries a matching MD5. Uploads set `md5`, `sha256` and `content-type`
 * metadata on the object.
 *
 * Throws if an upload fails.
 */
export function mirrorToR2(files: FileRef[]): MirrorStats {
	const cfg = config();
	const stats: MirrorStats = { uploaded: 0, skipped: 0 };

	console.log('Mirroring data files to R2...');
	for (const file of files) {
		const key = keyOf(file);

		if (remoteMd5(cfg, key) === file.md5) {
			stats.skipped++;
			continue;
		}

		console.log(` - Uploading ${key} (${file.sizeString})`);
		const result = runRclone([
			'copyto',
			'--progress',
			'--retries', '3',
			'--metadata',
			'--metadata-set', `md5=${file.md5}`,
			'--metadata-set', `sha256=${file.sha256}`,
			'--metadata-set', 'content-type=application/octet-stream',
			sftpSource(cfg, file.remotePath),
			r2Dest(cfg, key),
		], { inherit: true });

		if (result.status !== 0) {
			throw new Error(`rclone failed to upload ${key} (exit ${result.status})`);
		}
		stats.uploaded++;
	}

	console.log(` - ${stats.uploaded} uploaded, ${stats.skipped} unchanged`);
	return stats;
}
