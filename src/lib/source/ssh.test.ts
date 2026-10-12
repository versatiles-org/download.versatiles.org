import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolve } from 'path';
import { buildSSHArgs } from './ssh.js';

beforeEach(() => {
	vi.stubEnv('STORAGE_URL', 'user@host');
	vi.stubEnv('SSH_KEY', undefined);
	vi.stubEnv('SSH_PORT', undefined);
	vi.stubEnv('SSH_KNOWN_HOSTS', undefined);
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('buildSSHArgs', () => {
	it('includes host, port, identity and the remote command', () => {
		const args = buildSSHArgs(['ls', '-lR', '/home']);
		expect(args.slice(0, 5)).toEqual(['user@host', '-p', '23', '-i', resolve('.ssh/storage')]);
		expect(args).toContain('-oBatchMode=yes');
		expect(args).toContain('-oIdentitiesOnly=yes');
		expect(args).toContain('-oConnectTimeout=15');
		expect(args).toContain('-oServerAliveInterval=30');
		expect(args.slice(-3)).toEqual(['ls', '-lR', '/home']);
	});

	it('uses the port from SSH_PORT', () => {
		vi.stubEnv('SSH_PORT', '2222');
		expect(buildSSHArgs([]).slice(1, 3)).toEqual(['-p', '2222']);
	});

	it('accepts a new host key when no known-hosts file is configured', () => {
		const args = buildSSHArgs([]);
		expect(args).toContain('-oStrictHostKeyChecking=accept-new');
		expect(args.some((arg) => arg.startsWith('-oUserKnownHostsFile'))).toBe(false);
	});

	it('checks the host key strictly against SSH_KNOWN_HOSTS', () => {
		vi.stubEnv('SSH_KNOWN_HOSTS', '/keys/known_hosts');
		const args = buildSSHArgs([]);
		expect(args).toContain('-oUserKnownHostsFile=/keys/known_hosts');
		expect(args).toContain('-oStrictHostKeyChecking=yes');
		expect(args).not.toContain('-oStrictHostKeyChecking=accept-new');
	});

	it('throws when STORAGE_URL is not set', () => {
		vi.stubEnv('STORAGE_URL', undefined);
		expect(() => buildSSHArgs([])).toThrow(/STORAGE_URL/);
	});
});
