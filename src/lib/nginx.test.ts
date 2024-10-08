import { jest } from '@jest/globals';
import type { FileRef as FileRefType } from './file_ref.js'

// Mock the necessary dependencies
jest.unstable_mockModule('node:fs', () => ({
	readFileSync: jest.fn(),
	writeFileSync: jest.fn(),
	statSync: jest.fn(),
	readdirSync: jest.fn(),
}));

jest.spyOn(console, 'log').mockImplementation(() => { });

const { readFileSync, writeFileSync, statSync } = await import('node:fs');
const { FileRef } = await import('./file_ref.js');
const { generateNGINX } = await import('./nginx.js');

describe('generateNGINX', () => {
	let mockFiles: FileRefType[];

	beforeEach(() => {
		mockFiles = [
			new FileRef('/path/to/local/file1.versatiles', 1000),
			new FileRef('/path/to/local/file2.versatiles', 2000),
		];

		(readFileSync as jest.Mock).mockReturnValue('{{#each files}}{{{url}}},{{{fullname}}};{{/each}}');
		(writeFileSync as jest.Mock).mockImplementation(() => { });
		(statSync as jest.Mock).mockImplementation(() => ({ size: 123 }));
	});

	it('should generate NGINX configuration using the template and write it to the given file', () => {
		const result = generateNGINX(mockFiles, 'download.versatiles.org', '/path/to/output/nginx.conf');

		const templateFilename = new URL('../../template/nginx.conf', import.meta.url).pathname;
		expect(readFileSync).toHaveBeenCalledWith(templateFilename, 'utf-8');

		// Ensure writeFileSync is called with the correct filename and generated HTML
		expect(writeFileSync).toHaveBeenCalledTimes(1);
		expect(writeFileSync).toHaveBeenCalledWith(
			'/path/to/output/nginx.conf',
			'file1.versatiles,/path/to/local/file1.versatiles;file2.versatiles,/path/to/local/file2.versatiles;'
		);

		// Ensure the result is a FileRef object
		expect(result).toBeInstanceOf(FileRef);
		expect(result.fullname).toBe('/path/to/output/nginx.conf');
	});
});
