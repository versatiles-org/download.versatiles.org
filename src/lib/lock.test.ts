import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { acquireLock } from './lock.js';

console.log = vi.fn();

let dir: string;
let file: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'lock-test-'));
	file = join(dir, 'nested', '.lock');
});

afterEach(() => {
	vi.restoreAllMocks();
	rmSync(dir, { recursive: true, force: true });
});

describe('acquireLock', () => {
	it('creates the lock with the pid of this process and removes it on release', () => {
		const release = acquireLock(file);

		expect(readFileSync(file, 'utf-8').split('\n')[0]).toBe(String(process.pid));

		release();
		expect(existsSync(file)).toBe(false);
	});

	it('refuses a lock held by a live process', () => {
		const release = acquireLock(file);

		// The owner is this very process, so it is certainly alive.
		expect(() => acquireLock(file)).toThrow(new RegExp(`already running \\(pid ${process.pid},`));

		release();
	});

	it('takes over the lock of a process that no longer exists', () => {
		acquireLock(file);
		vi.spyOn(process, 'kill').mockImplementation(() => {
			throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
		});

		const release = acquireLock(file);

		expect(existsSync(file)).toBe(true);
		release();
		expect(existsSync(file)).toBe(false);
	});

	it('respects a lock held by a process of another user', () => {
		acquireLock(file);
		vi.spyOn(process, 'kill').mockImplementation(() => {
			throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
		});

		expect(() => acquireLock(file)).toThrow(/already running/);
	});

	it('takes over a lock file with unreadable content', () => {
		acquireLock(file);
		writeFileSync(file, 'garbage');

		expect(() => acquireLock(file)).not.toThrow();
	});

	it('can be released twice', () => {
		const release = acquireLock(file);
		release();
		expect(() => release()).not.toThrow();
	});
});
