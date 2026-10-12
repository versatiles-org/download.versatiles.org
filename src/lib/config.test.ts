import { describe, it, expect } from 'vitest';
import { homedir } from 'os';
import { resolve } from 'path';
import { loadConfig, rcloneConfig, sshConfig } from './config.js';

const complete = {
	DOMAIN: 'example.org',
	STORAGE_URL: 'user@host',
	RCLONE_SFTP_REMOTE: 'hetzner',
	RCLONE_R2_REMOTE: 'r2',
	R2_BUCKET: 'downloads',
};

describe('loadConfig', () => {
	it('applies the defaults for everything optional', () => {
		expect(loadConfig(complete)).toEqual({
			domain: 'example.org',
			maxUploadBytes: undefined,
			ssh: {
				storageUrl: 'user@host',
				storageRoot: '/home',
				key: resolve('.ssh/storage'),
				port: '23',
				knownHosts: undefined,
			},
			rclone: {
				bin: 'rclone',
				sftpRemote: 'hetzner',
				r2Remote: 'r2',
				bucket: 'downloads',
				sftpStripPrefix: '/home/',
			},
		});
	});

	it('reads the optional variables', () => {
		const config = loadConfig({
			...complete,
			STORAGE_ROOT: '/home/download',
			SSH_KEY: '/keys/id',
			SSH_PORT: '2222',
			SSH_KNOWN_HOSTS: '/keys/known_hosts',
			RCLONE_BIN: '/opt/rclone',
			RCLONE_SFTP_STRIP_PREFIX: '/',
		});

		expect(config.ssh).toMatchObject({
			storageRoot: '/home/download',
			key: '/keys/id',
			port: '2222',
			knownHosts: '/keys/known_hosts',
		});
		expect(config.rclone).toMatchObject({ bin: '/opt/rclone', sftpStripPrefix: '/' });
	});

	it('reports every missing variable in one error', () => {
		let message = '';
		try {
			loadConfig({});
		} catch (error) {
			message = (error as Error).message;
		}
		for (const name of Object.keys(complete)) expect(message).toContain(`${name} is not set`);
	});

	it('treats an empty value as missing', () => {
		expect(() => loadConfig({ ...complete, R2_BUCKET: '' })).toThrow(/R2_BUCKET is not set/);
	});

	it.each(['0', '65536', '23a', '2.5'])('rejects SSH_PORT=%s', (port) => {
		expect(() => loadConfig({ ...complete, SSH_PORT: port })).toThrow(/SSH_PORT must be a port number/);
	});
});

describe('MAX_UPLOAD_GB', () => {
	it('is converted to bytes', () => {
		expect(loadConfig({ ...complete, MAX_UPLOAD_GB: '80' }).maxUploadBytes).toBe(80 * 2 ** 30);
		expect(loadConfig({ ...complete, MAX_UPLOAD_GB: '0.5' }).maxUploadBytes).toBe(2 ** 29);
	});

	it('means no limit when empty', () => {
		expect(loadConfig({ ...complete, MAX_UPLOAD_GB: '' }).maxUploadBytes).toBeUndefined();
	});

	it.each(['0', '-1', 'eighty', '80GB'])('rejects %s', (value) => {
		expect(() => loadConfig({ ...complete, MAX_UPLOAD_GB: value })).toThrow(/MAX_UPLOAD_GB must be a positive number/);
	});
});

describe('sshConfig', () => {
	it('needs only the Storage Box variables', () => {
		expect(sshConfig({ STORAGE_URL: 'user@host' }).storageUrl).toBe('user@host');
		expect(() => sshConfig({})).toThrow(/STORAGE_URL is not set/);
	});

	it.each([
		['~/.ssh/id', resolve(homedir(), '.ssh/id')],
		['$HOME/.ssh/id', resolve(homedir(), '.ssh/id')],
		['~', homedir()],
		['keys/id', resolve('keys/id')],
	])('resolves the key path %s', (key, expected) => {
		expect(sshConfig({ STORAGE_URL: 'user@host', SSH_KEY: key }).key).toBe(expected);
	});

	it('resolves the known-hosts path', () => {
		const config = sshConfig({ STORAGE_URL: 'user@host', SSH_KNOWN_HOSTS: '~/.ssh/known_hosts' });
		expect(config.knownHosts).toBe(resolve(homedir(), '.ssh/known_hosts'));
	});
});

describe('rcloneConfig', () => {
	it('needs only the rclone variables', () => {
		const env = { RCLONE_SFTP_REMOTE: 'hetzner', RCLONE_R2_REMOTE: 'r2', R2_BUCKET: 'downloads' };
		expect(rcloneConfig(env).bucket).toBe('downloads');
		expect(() => rcloneConfig({ ...env, R2_BUCKET: undefined })).toThrow(/R2_BUCKET is not set/);
	});
});
