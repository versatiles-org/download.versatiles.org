import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FileRef as FileRefType } from './file_ref.js';
import { Stats } from 'fs';

vi.mock('fs', () => ({
	createReadStream: vi.fn(),
	existsSync: vi.fn(),
	readdirSync: vi.fn(),
	readFileSync: vi.fn(),
	statSync: vi.fn(),
	writeFileSync: vi.fn(),
}));

const child_process = { spawnSync: vi.fn(), };
vi.mock('child_process', () => ({ ...child_process, default: child_process }));

vi.spyOn(console, 'error').mockImplementation(() => { });
vi.spyOn(console, 'log').mockImplementation(() => { });

const { existsSync, readFileSync, writeFileSync, statSync } = await import('fs');
const { spawnSync } = await import('child_process');
const { FileRef } = await import('./file_ref.js');
const { generateHashes } = await import('./hashes.js');

describe('generateHashes', () => {
	let file1: FileRefType, file2: FileRefType;

	beforeEach(() => {
		file1 = new FileRef('/path/file1.versatiles', 1000);
		file2 = new FileRef('/path/file2.versatiles', 2000);

		vi.mocked(existsSync).mockReset().mockReturnValue(false);
		vi.mocked(readFileSync).mockReset().mockImplementation(f => {
			const parts = String(f).split('.');
			const extension = parts.pop();
			const filename = parts.join('.');
			return `${extension}_c0ffee ${filename}\n`;
		});
		vi.mocked(writeFileSync).mockReset().mockImplementation(() => { });
		vi.mocked(statSync).mockReset().mockReturnValue({ size: 100 } as Stats);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vi.mocked<any>(spawnSync).mockReset().mockImplementation((_: string, args: string[]) => {
			const filename = args.pop();
			const hash = args.pop()?.replace('sum', '');
			return {
				stdout: Buffer.from(`${hash}_c0ffee ${filename}`),
				stderr: Buffer.alloc(0)
			};
		});
	});

	it('should generate and write missing hashes for files', async () => {
		await generateHashes([file1, file2], '/path/');

		expect(file1.hashes?.md5).toBe('md5_c0ffee');
		expect(file1.hashes?.sha256).toBe('sha256_c0ffee');
		expect(file2.hashes?.md5).toBe('md5_c0ffee');
		expect(file2.hashes?.sha256).toBe('sha256_c0ffee');

		expect(spawnSync).toHaveBeenCalledTimes(4);

		expect(writeFileSync).toHaveBeenNthCalledWith(1, '/path/file1.versatiles.md5', 'md5_c0ffee file1.versatiles');
		expect(writeFileSync).toHaveBeenNthCalledWith(2, '/path/file1.versatiles.sha256', 'sha256_c0ffee file1.versatiles');
		expect(writeFileSync).toHaveBeenNthCalledWith(3, '/path/file2.versatiles.md5', 'md5_c0ffee file2.versatiles');
		expect(writeFileSync).toHaveBeenNthCalledWith(4, '/path/file2.versatiles.sha256', 'sha256_c0ffee file2.versatiles');
	});

	it('should skip files if hashes already exist', async () => {
		// Simulate that the hash files already exist
		vi.mocked(existsSync).mockReturnValue(true);

		await generateHashes([file1], '/path/');

		expect(file1.hashes?.md5).toBe('md5_c0ffee');
		expect(file1.hashes?.sha256).toBe('sha256_c0ffee');

		expect(readFileSync).toHaveBeenCalledTimes(2);
		expect(readFileSync).toHaveBeenNthCalledWith(1, '/path/file1.versatiles.md5', 'utf8');
		expect(readFileSync).toHaveBeenNthCalledWith(2, '/path/file1.versatiles.sha256', 'utf8');

		expect(spawnSync).toHaveBeenCalledTimes(0);

		expect(writeFileSync).not.toHaveBeenCalled();
	});
});
