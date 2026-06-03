import { describe, it, expect, afterEach } from 'vitest';
import { buildSSHArgs } from './ssh.js';

const original = process.env['STORAGE_URL'];

afterEach(() => {
	if (original === undefined) delete process.env['STORAGE_URL'];
	else process.env['STORAGE_URL'] = original;
});

describe('buildSSHArgs', () => {
	it('includes host, port, identity and the remote command', () => {
		process.env['STORAGE_URL'] = 'user@host';
		const args = buildSSHArgs(['ls', '-lR', '/home']);
		expect(args[0]).toBe('user@host');
		expect(args).toContain('-p');
		expect(args).toContain('23');
		expect(args).toContain('-oBatchMode=yes');
		expect(args.slice(-3)).toEqual(['ls', '-lR', '/home']);
	});

	it('throws when STORAGE_URL is not set', () => {
		delete process.env['STORAGE_URL'];
		expect(() => buildSSHArgs([])).toThrow(/STORAGE_URL/);
	});
});
