import { jest } from '@jest/globals';
import type { FileGroup } from './file_group.js';
import type { FileRef as FileRefType } from './file_ref.js';
import type { PathLike, ReadStream } from 'node:fs';

// Mock the necessary dependencies
jest.unstable_mockModule('node:fs', () => ({
	createReadStream: jest.fn(),
	existsSync: jest.fn(),
	readFileSync: jest.fn(),
	writeFileSync: jest.fn(),
	statSync: jest.fn(() => ({ size: 123 })),
}));

jest.spyOn(console, 'error').mockImplementation(() => { });
jest.spyOn(console, 'log').mockImplementation(() => { });

const { createReadStream, existsSync, readFileSync, writeFileSync } = await import('node:fs');
const { FileRef } = await import('./file_ref.js');
const { generateHashes, generateLists, hex2base64 } = await import('./hashes.js');

describe('generateHashes', () => {
	let file1: FileRefType, file2: FileRefType;

	beforeEach(() => {
		file1 = new FileRef('/path/file1.versatiles', 1000);
		file2 = new FileRef('/path/file2.versatiles', 2000);

		type F = (event: string | symbol, listener: (...args: unknown[]) => void) => ReadStream;

		(existsSync as jest.Mock).mockReset().mockReturnValue(false); // Simulate that hash files do not exist
		(readFileSync as jest.Mock).mockReset().mockImplementation(() => 'existing-hash');
		(writeFileSync as jest.Mock).mockReset().mockImplementation(() => { });
		(createReadStream as jest.Mock<typeof createReadStream>).mockReset().mockImplementation((path: PathLike) => {
			const stream = {
				on: jest.fn<F>().mockImplementation((event: string | symbol, listener: (buffer?: Buffer) => void): ReadStream => {
					if (event === 'data') listener(Buffer.from('content of ' + path));
					if (event === 'close') listener();
					return stream;
				})
			} as unknown as ReadStream;
			return stream;
		});
	});

	it('should generate and write missing hashes for files', async () => {
		await generateHashes([file1, file2]);

		expect(createReadStream).toHaveBeenCalledTimes(2);

		expect(writeFileSync).toHaveBeenNthCalledWith(1, '/path/file1.versatiles.md5', '8c59e1fc3627fb366f0aab85617ff576');
		expect(writeFileSync).toHaveBeenNthCalledWith(2, '/path/file1.versatiles.sha256', '19de64376b378d1ead1e7c4ffbebd2863c86bc11f1d42a6254b7fce348c6f1d9');
		expect(writeFileSync).toHaveBeenNthCalledWith(3, '/path/file2.versatiles.md5', 'adb02d9d56ea9c9619f410b7fe20b93e');
		expect(writeFileSync).toHaveBeenNthCalledWith(4, '/path/file2.versatiles.sha256', '8b1a9a806bbf5a258dcac598f118a9567289aa8acc08e28f866554289e1e43f5');
	});

	it('should skip files if hashes already exist', async () => {
		// Simulate that the hash files already exist
		(existsSync as jest.Mock).mockReturnValue(true);

		await generateHashes([file1]);

		expect(readFileSync).toHaveBeenCalledTimes(2);
		expect(readFileSync).toHaveBeenNthCalledWith(1, '/path/file1.versatiles.md5', 'utf8');
		expect(readFileSync).toHaveBeenNthCalledWith(2, '/path/file1.versatiles.sha256', 'utf8');

		expect(createReadStream).toHaveBeenCalledTimes(0);

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
		expect(writeFileSync).toHaveBeenCalledWith('/local/folder/slug.tsv', 'https://example.com/file1.versatiles;1000;q80=');
		expect(result).toEqual([]);
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
