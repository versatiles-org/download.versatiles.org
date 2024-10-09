import { jest } from '@jest/globals';
import type { FileGroup } from './file_group.js';
import type { FileRef as FileRefType } from './file_ref.js';

jest.unstable_mockModule('node:fs', () => ({
	createReadStream: jest.fn(),
	existsSync: jest.fn(),
	readdirSync: jest.fn(),
	readFileSync: jest.fn(),
	statSync: jest.fn(),
	writeFileSync: jest.fn(),
}));

jest.unstable_mockModule('node:child_process', () => ({
	spawnSync: jest.fn(),
}));

jest.spyOn(console, 'error').mockImplementation(() => { });
jest.spyOn(console, 'log').mockImplementation(() => { });

const { existsSync, readFileSync, writeFileSync, statSync } = await import('node:fs');
const { spawnSync } = await import('node:child_process');
const { FileRef } = await import('./file_ref.js');
const { generateHashes, generateLists, hex2base64 } = await import('./hashes.js');

describe('generateHashes', () => {
	let file1: FileRefType, file2: FileRefType;

	beforeEach(() => {
		file1 = new FileRef('/path/file1.versatiles', 1000);
		file2 = new FileRef('/path/file2.versatiles', 2000);

		(existsSync as jest.Mock).mockReset().mockReturnValue(false);
		(readFileSync as jest.Mock).mockReset().mockImplementation(() => 'existing-hash');
		(writeFileSync as jest.Mock).mockReset().mockImplementation(() => { });
		(statSync as jest.Mock).mockReset().mockReturnValue({ size: 100 });
		(spawnSync as unknown as jest.Mock<(_: string, args: string[]) => { stderr: Buffer, stdout: Buffer }>).mockReset().mockImplementation((_: string, args: string[]) => {
			const filename = args.pop();
			const hash = args.pop()?.replace('sum', '');
			return {
				stdout: Buffer.from(`${hash}_c0ffee ${filename}`),
				stderr: Buffer.alloc(0)
			}
		});
	});

	it('should generate and write missing hashes for files', async () => {
		await generateHashes([file1, file2], '/path/');

		expect(spawnSync).toHaveBeenCalledTimes(4);

		expect(writeFileSync).toHaveBeenNthCalledWith(1, '/path/file1.versatiles.md5', 'md5_c0ffee file1.versatiles');
		expect(writeFileSync).toHaveBeenNthCalledWith(2, '/path/file1.versatiles.sha256', 'sha256_c0ffee file1.versatiles');
		expect(writeFileSync).toHaveBeenNthCalledWith(3, '/path/file2.versatiles.md5', 'md5_c0ffee file2.versatiles');
		expect(writeFileSync).toHaveBeenNthCalledWith(4, '/path/file2.versatiles.sha256', 'sha256_c0ffee file2.versatiles');
	});

	it('should skip files if hashes already exist', async () => {
		// Simulate that the hash files already exist
		(existsSync as jest.Mock).mockReturnValue(true);

		await generateHashes([file1], '/path/');

		expect(readFileSync).toHaveBeenCalledTimes(2);
		expect(readFileSync).toHaveBeenNthCalledWith(1, '/path/file1.versatiles.md5', 'utf8');
		expect(readFileSync).toHaveBeenNthCalledWith(2, '/path/file1.versatiles.sha256', 'utf8');

		expect(spawnSync).toHaveBeenCalledTimes(0);

		expect(writeFileSync).not.toHaveBeenCalled();
	});
});

describe('generateLists', () => {
	let fileGroup: FileGroup;

	beforeEach(() => {
		const file = new FileRef('/path/file1.versatiles', 1000);
		file.hashes = { md5: 'abcd', sha: '0123' };

		fileGroup = {
			slug: 'slug',
			title: 'OpenStreetMap as vector tiles',
			desc: 'Test description',
			order: 0,
			local: true,
			latestFile: file,
			olderFiles: [],
		};

		(writeFileSync as jest.Mock).mockReset().mockImplementation(() => { });
	});

	it('should generate lists and write to a file', () => {
		(readFileSync as jest.Mock).mockReset().mockImplementation(() => '{{#each files}}{{{url}}};{{{size}}};{{{md5}}}{{/each}}');
		const result = generateLists([fileGroup], 'https://example.com', '/local/folder');

		expect(writeFileSync).toHaveBeenCalledTimes(1);
		expect(writeFileSync).toHaveBeenCalledWith('/local/folder/urllist_slug.tsv', 'https://example.com/file1.versatiles;1000;q80=');
		expect(result.length).toBe(1);
		expect(result[0].fullname).toBe('/local/folder/urllist_slug.tsv');
		expect(result[0].filename).toBe('urllist_slug.tsv');
		expect(result[0].url).toBe('urllist_slug.tsv');
	});

	it('should throw an error if hashes are missing', () => {
		// Remove the hashes from the latestFile
		fileGroup.latestFile!.hashes = undefined;

		expect(() => generateLists([fileGroup], 'https://example.com', '/local/folder')).toThrow();
	});
});

describe('hex2base64', () => {
	it('should correctly convert hex to base64url', () => {
		const hex = 'deadbeef';
		const base64 = hex2base64(hex);
		expect(base64).toBe('3q2-7w=='); // Expected base64url-encoded value
	});

	it('should pad the base64 string to a multiple of 4', () => {
		const hex = 'deadbe';
		const base64 = hex2base64(hex);
		expect(base64).toBe('3q2-'); // Base64url-encoded value with correct padding
	});
});
