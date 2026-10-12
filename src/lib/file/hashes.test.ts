import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ScannedFile } from '../source/scan.js';

console.log = vi.fn();

const ssh = {
	sshExec: vi.fn(),
	scpUpload: vi.fn(),
	connectionFailed: (result: { status: number }) => result.status === 255,
};

/** A remote command that ran and succeeded. */
const ok = (stdout: string) => ({ success: true, status: 0, stdout, stderr: '' });
/** A remote command that ran and failed, e.g. `cat` of a file that does not exist. */
const failed = { success: false, status: 1, stdout: '', stderr: 'No such file or directory' };
/** ssh itself failed: no answer from the remote command. */
const unreachable = { success: false, status: 255, stdout: '', stderr: 'Connection timed out' };
vi.mock('../source/ssh.js', () => ssh);

vi.mock('fs', () => ({
	writeFileSync: vi.fn(),
	unlinkSync: vi.fn(),
}));

vi.mock('os', () => ({ tmpdir: () => '/tmp' }));

const { FileRef } = await import('./file_ref.js');
const { generateHashes } = await import('./hashes.js');
const { writeFileSync, unlinkSync } = await import('fs');

const MD5 = 'a'.repeat(32);
const SHA = 'b'.repeat(64);
const PATH = '/home/osm/osm.versatiles';

/** A scanned data file modified at `mtime`, with sidecars modified at the given times. */
function scanned(
	mtime: number | null,
	sidecars: { md5?: number | null; sha256?: number | null } = {},
	path = PATH,
): ScannedFile {
	const result: ScannedFile = { file: new FileRef(path, 100, path), mtime, sidecars: {} };
	if (sidecars.md5 !== undefined) result.sidecars.md5 = { mtime: sidecars.md5 };
	if (sidecars.sha256 !== undefined) result.sidecars.sha256 = { mtime: sidecars.sha256 };
	return result;
}

/** Answers `cat` with the given sidecar content and `<type>sum` with a valid hash. */
function remote(sidecar: (type: 'md5' | 'sha256') => string = (type) => (type === 'md5' ? MD5 : SHA)): void {
	ssh.sshExec.mockImplementation(async (args: string[]) => {
		if (args[0] === 'cat') return ok(`${sidecar(args[1].endsWith('.md5') ? 'md5' : 'sha256')}  file.versatiles\n`);
		return ok(`${args[0] === 'md5sum' ? MD5 : SHA}  ${PATH}\n`);
	});
	ssh.scpUpload.mockResolvedValue(true);
}

/** The remote commands that were run, e.g. `['cat', 'md5sum']`. */
const commands = (): string[] => ssh.sshExec.mock.calls.map((call) => (call[0] as string[])[0]);

describe('generateHashes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('uses fresh existing sidecars (sidecar newer than data)', async () => {
		remote();

		const file = scanned(1000, { md5: 2000, sha256: 2000 });
		await generateHashes([file]);

		expect(file.file.hashes).toEqual({ md5: MD5, sha256: SHA });
		// One `cat` per sidecar and nothing else: the ages came with the scan.
		expect(commands()).toEqual(['cat', 'cat']);
		expect(ssh.scpUpload).not.toHaveBeenCalled();
		expect(writeFileSync).not.toHaveBeenCalled();
	});

	it('uses a sidecar exactly as old as its data file', async () => {
		remote();

		await generateHashes([scanned(1000, { md5: 1000, sha256: 1000 })]);

		expect(commands()).toEqual(['cat', 'cat']);
	});

	it('computes a missing sidecar without asking for it first', async () => {
		remote();

		const file = scanned(1000);
		await generateHashes([file]);

		expect(file.file.hashes).toEqual({ md5: MD5, sha256: SHA });
		expect(commands()).toEqual(['md5sum', 'sha256sum']);
		expect(ssh.sshExec).toHaveBeenCalledWith(['md5sum', PATH]);
		expect(ssh.scpUpload).toHaveBeenCalledTimes(2);
		expect(writeFileSync).toHaveBeenCalledTimes(2);
		expect(unlinkSync).toHaveBeenCalledTimes(2);
	});

	it('recomputes a stale sidecar (older than the data file) without reading it', async () => {
		remote();

		const file = scanned(2000, { md5: 1000, sha256: 3000 });
		await generateHashes([file]);

		expect(file.file.hashes).toEqual({ md5: MD5, sha256: SHA });
		// md5 is stale → computed; sha256 is fresh → read.
		expect(commands().sort()).toEqual(['cat', 'md5sum']);
		expect(ssh.sshExec).toHaveBeenCalledWith(['cat', `${PATH}.sha256`], { timeout: 60000 });
		expect(ssh.scpUpload).toHaveBeenCalledTimes(1);
	});

	it('assumes a sidecar is fresh when the scan has no modification times', async () => {
		remote();

		await generateHashes([scanned(null, { md5: null, sha256: null })]);

		expect(commands()).toEqual(['cat', 'cat']);
	});

	it('computes a sidecar that was listed by the scan but is gone when read', async () => {
		ssh.sshExec.mockImplementation(async (args: string[]) =>
			args[0] === 'cat' ? failed : ok(`${args[0] === 'md5sum' ? MD5 : SHA}  ${PATH}\n`),
		);
		ssh.scpUpload.mockResolvedValue(true);

		const file = scanned(1000, { md5: 2000, sha256: 2000 });
		await generateHashes([file]);

		expect(file.file.hashes).toEqual({ md5: MD5, sha256: SHA });
		expect(ssh.scpUpload).toHaveBeenCalledTimes(2);
	});

	it('throws when a hash can neither be downloaded nor computed', async () => {
		ssh.sshExec.mockResolvedValue(failed);

		await expect(generateHashes([scanned(1000)])).rejects.toThrow(/Failed to calculate.*No such file/);
	});

	it('aborts instead of recomputing when the Storage Box cannot be reached', async () => {
		ssh.sshExec.mockResolvedValue(unreachable);

		await expect(generateHashes([scanned(1000, { md5: 2000, sha256: 2000 })])).rejects.toThrow(
			/Could not reach the Storage Box.*Connection timed out/,
		);

		// The failed `cat` must not be read as "sidecar missing".
		expect(commands()).not.toContain('md5sum');
		expect(commands()).not.toContain('sha256sum');
		expect(ssh.scpUpload).not.toHaveBeenCalled();
	});

	it.each([
		['too short', 'abc123'],
		['not hexadecimal', 'z'.repeat(32)],
		['of the wrong length for its type', 'a'.repeat(40)],
	])('recomputes when the sidecar content is %s', async (_what, content) => {
		remote(() => content);

		const file = scanned(1000, { md5: 2000, sha256: 2000 });
		await generateHashes([file]);

		expect(file.file.hashes).toEqual({ md5: MD5, sha256: SHA });
		expect(ssh.scpUpload).toHaveBeenCalledTimes(2);
	});

	it('rejects a computed hash that is not a hash', async () => {
		ssh.sshExec.mockResolvedValue(ok('md5sum: something went wrong'));

		await expect(generateHashes([scanned(1000)])).rejects.toThrow(/Failed to calculate/);
		expect(ssh.scpUpload).not.toHaveBeenCalled();
	});

	it('returns no unhashed files when computing is allowed', async () => {
		remote();

		expect(await generateHashes([scanned(1000)])).toEqual([]);
	});

	describe('without computing (dry run)', () => {
		it('reads existing sidecars but computes and writes nothing', async () => {
			remote();
			const complete = scanned(1000, { md5: 2000, sha256: 2000 });
			const partial = scanned(1000, { md5: 2000 }, '/home/b/partial.versatiles');
			const stale = scanned(3000, { md5: 2000, sha256: 2000 }, '/home/c/stale.versatiles');

			const unhashed = await generateHashes([complete, partial, stale], { compute: false });

			expect(complete.file.hashes).toEqual({ md5: MD5, sha256: SHA });
			// Left without hashes rather than with half of them.
			expect(partial.file.hashes).toBeUndefined();
			expect(stale.file.hashes).toBeUndefined();
			expect(unhashed).toEqual([partial.file, stale.file]);

			expect(commands().every((command) => command === 'cat')).toBe(true);
			expect(ssh.scpUpload).not.toHaveBeenCalled();
			expect(writeFileSync).not.toHaveBeenCalled();
		});
	});

	it('gives reading a sidecar a timeout but not the hash computation', async () => {
		remote();

		await generateHashes([scanned(1000, { md5: 2000 })]);

		expect(ssh.sshExec).toHaveBeenCalledWith(['cat', `${PATH}.md5`], { timeout: 60000 });
		expect(ssh.sshExec).toHaveBeenCalledWith(['sha256sum', PATH]);
	});
});
