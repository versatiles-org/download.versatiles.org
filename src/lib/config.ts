/**
 * Configuration of the updater, read from environment variables.
 *
 * Every variable is read and validated here, so a misconfiguration is reported
 * once, by name, instead of surfacing halfway through a run from whichever
 * module happened to need the value first. `loadConfig()` checks everything and
 * is the first thing `run()` does; `sshConfig()` and `rcloneConfig()` return
 * the part a single module needs.
 *
 * Values are read on every call rather than cached at import time, so tests can
 * change `process.env` between cases.
 *
 * See `.env.sample` for a description of each variable.
 */
import { homedir } from 'os';
import { join, resolve } from 'path';

type Env = Record<string, string | undefined>;

/** Connection settings for the Hetzner Storage Box. */
export interface SshConfig {
	/** `user@host` of the Storage Box. */
	storageUrl: string;
	/** Remote subtree that is scanned for datasets. */
	storageRoot: string;
	/** Absolute path of the SSH identity file. */
	key: string;
	/** SSH port (Hetzner uses 23). */
	port: string;
	/**
	 * Absolute path of a known-hosts file holding the Storage Box host key. When
	 * set, the host key is checked strictly against it; otherwise an unknown host
	 * key is accepted on first contact.
	 */
	knownHosts?: string;
}

/** rclone remotes used to move data to R2. */
export interface RcloneConfig {
	/** rclone executable. */
	bin: string;
	/** Name of the configured SFTP remote (source). */
	sftpRemote: string;
	/** Name of the configured S3/R2 remote (destination). */
	r2Remote: string;
	/** Target bucket. */
	bucket: string;
	/** Prefix stripped from absolute Storage Box paths to form rclone SFTP paths. */
	sftpStripPrefix: string;
}

/** The complete updater configuration. */
export interface Config {
	/** Public domain used to build absolute URLs. */
	domain: string;
	/**
	 * Largest data file, in bytes, that this run may upload from the Storage Box.
	 * Larger uploads are deferred to a run without a limit. Undefined: no limit.
	 */
	maxUploadBytes?: number;
	/** Only report what a run would do, without changing anything (`DRY_RUN`). */
	dryRun: boolean;
	ssh: SshConfig;
	rclone: RcloneConfig;
}

/**
 * Reads variables from an environment and remembers every problem it finds, so
 * that all of them can be reported in a single error.
 */
class Reader {
	private readonly problems: string[] = [];

	constructor(private readonly env: Env) {}

	required(name: string): string {
		const value = this.env[name];
		if (!value) this.problems.push(`${name} is not set`);
		return value ?? '';
	}

	optional(name: string): string | undefined {
		return this.env[name] || undefined;
	}

	port(name: string, fallback: string): string {
		const value = this.env[name] || fallback;
		const port = Number(value);
		if (!Number.isInteger(port) || port < 1 || port > 65535) {
			this.problems.push(`${name} must be a port number, got "${value}"`);
		}
		return value;
	}

	/** An optional size given in GB (2^30 bytes, as sizes are displayed), returned in bytes. */
	gigabytes(name: string): number | undefined {
		const value = this.env[name];
		if (!value) return undefined;
		const gigabytes = Number(value);
		if (!Number.isFinite(gigabytes) || gigabytes <= 0) {
			this.problems.push(`${name} must be a positive number of GB, got "${value}"`);
			return undefined;
		}
		return Math.round(gigabytes * 2 ** 30);
	}

	/** An optional switch: `1`, `true` or `yes` turn it on; unset, empty, `0`, `false` or `no` leave it off. */
	flag(name: string): boolean {
		const value = (this.env[name] ?? '').toLowerCase();
		if (['1', 'true', 'yes'].includes(value)) return true;
		if (!['', '0', 'false', 'no'].includes(value)) {
			this.problems.push(`${name} must be 1 or 0, got "${this.env[name]}"`);
		}
		return false;
	}

	/** Throws if any variable was missing or invalid. */
	check(): void {
		if (this.problems.length === 0) return;
		throw new Error(`Invalid configuration (see .env.sample):\n${this.problems.map((p) => ` - ${p}`).join('\n')}`);
	}
}

/**
 * Resolves a path to an absolute one, expanding a leading `~` or `$HOME` (env
 * files pass these literally — neither Node nor ssh expand them).
 */
function resolvePath(p: string): string {
	let out = p;
	if (out === '~') out = homedir();
	else if (out.startsWith('~/')) out = join(homedir(), out.slice(2));
	else if (out.startsWith('$HOME/')) out = join(homedir(), out.slice('$HOME/'.length));
	return resolve(out);
}

function readSsh(reader: Reader): SshConfig {
	const knownHosts = reader.optional('SSH_KNOWN_HOSTS');
	return {
		storageUrl: reader.required('STORAGE_URL'),
		storageRoot: reader.optional('STORAGE_ROOT') ?? '/home',
		key: resolvePath(reader.optional('SSH_KEY') ?? '.ssh/storage'),
		port: reader.port('SSH_PORT', '23'),
		knownHosts: knownHosts ? resolvePath(knownHosts) : undefined,
	};
}

function readRclone(reader: Reader): RcloneConfig {
	return {
		bin: reader.optional('RCLONE_BIN') ?? 'rclone',
		sftpRemote: reader.required('RCLONE_SFTP_REMOTE'),
		r2Remote: reader.required('RCLONE_R2_REMOTE'),
		bucket: reader.required('R2_BUCKET'),
		sftpStripPrefix: reader.optional('RCLONE_SFTP_STRIP_PREFIX') ?? '/home/',
	};
}

/** Reads the Storage Box connection settings, or throws naming what is wrong. */
export function sshConfig(env: Env = process.env): SshConfig {
	const reader = new Reader(env);
	const config = readSsh(reader);
	reader.check();
	return config;
}

/** Reads the rclone settings, or throws naming what is wrong. */
export function rcloneConfig(env: Env = process.env): RcloneConfig {
	const reader = new Reader(env);
	const config = readRclone(reader);
	reader.check();
	return config;
}

/**
 * Reads and validates the whole configuration. Throws a single error listing
 * every missing or invalid variable.
 */
export function loadConfig(env: Env = process.env): Config {
	const reader = new Reader(env);
	const config: Config = {
		domain: reader.required('DOMAIN'),
		maxUploadBytes: reader.gigabytes('MAX_UPLOAD_GB'),
		dryRun: reader.flag('DRY_RUN'),
		ssh: readSsh(reader),
		rclone: readRclone(reader),
	};
	reader.check();
	return config;
}
