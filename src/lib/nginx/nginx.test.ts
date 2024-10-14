import { jest } from '@jest/globals';
import type { FileRef as FileRefType } from '../file/file_ref.js'
import { FileResponse } from '../file/file_response.js';

// Mock the necessary dependencies
jest.unstable_mockModule('node:fs', () => ({
	readFileSync: jest.fn(),
	writeFileSync: jest.fn(),
	statSync: jest.fn(),
	readdirSync: jest.fn(),
}));

jest.spyOn(console, 'log').mockImplementation(() => { });

const { readFileSync, writeFileSync, statSync } = await import('node:fs');
const { FileRef } = await import('../file/file_ref.js');
const { generateNginxConf: generateNGINX } = await import('./nginx.js');

describe('generateNGINX', () => {
	let mockFiles: FileRefType[];
	let mockResponses: FileResponse[];

	beforeEach(() => {
		mockFiles = [
			new FileRef('/path/to/local/a.bin', 1000),
			new FileRef('/path/to/local/b.bin', 2000),
		];

		mockResponses = [
			new FileResponse('c.txt', 'abc'),
			new FileResponse('d.txt', 'xyz'),
		];

		(readFileSync as jest.Mock).mockReturnValue('{{#each files}}{{{url}}},{{{fullname}}};{{/each}}#{{#each responses}}{{{url}}},{{{content}}};{{/each}}');
		(writeFileSync as jest.Mock).mockImplementation(() => { });
		(statSync as jest.Mock).mockImplementation(() => ({ size: 123 }));
	});

	it('should generate NGINX configuration using the template and write it to the given file', () => {
		const result = generateNGINX(mockFiles, mockResponses, '/path/to/output/nginx.conf');

		const templateFilename = new URL('../../../template/nginx.conf', import.meta.url).pathname;
		expect(readFileSync).toHaveBeenCalledWith(templateFilename, 'utf-8');

		// Ensure writeFileSync is called with the correct filename and generated HTML
		expect(writeFileSync).toHaveBeenCalledTimes(1);
		expect(writeFileSync).toHaveBeenCalledWith(
			'/path/to/output/nginx.conf',
			'a.bin,/path/to/local/a.bin;b.bin,/path/to/local/b.bin;#c.txt,abc;d.txt,xyz;'
		);

		// Ensure the result is a FileRef object
		expect(result).toBeInstanceOf(FileRef);
		expect(result.fullname).toBe('/path/to/output/nginx.conf');
	});
});
