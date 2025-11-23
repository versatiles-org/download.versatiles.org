import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FileRef as FileRefType } from '../file/file_ref.js'
import { FileResponse } from '../file/file_response.js';
import type { Stats } from 'fs';
import { buildNginxConf } from './nginx.js';
import { readFileSync, writeFileSync, statSync } from 'fs';
import { FileRef } from '../file/file_ref.js';

// Mock the necessary dependencies
vi.mock('fs', () => ({
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
	statSync: vi.fn(),
	readdirSync: vi.fn(),
}));

describe('buildNginxConf', () => {
	let mockFiles: FileRefType[];
	let mockResponses: FileResponse[];

	beforeEach(() => {
		mockFiles = [
			new FileRef('/path/to/local/a.bin', 1000),
			new FileRef('/path/to/local/b.bin', 2000),
		];

		mockResponses = [
			new FileResponse('/c.txt', 'abc'),
			new FileResponse('/d.txt', 'xyz'),
		];

		vi.mocked(readFileSync).mockReturnValue('{{#each files}}{{{url}}},{{{fullname}}};{{/each}}#{{#each responses}}{{{url}}},{{{content}}};{{/each}}');
		vi.mocked(writeFileSync).mockImplementation(() => { });
		vi.mocked(statSync).mockImplementation(() => ({ size: 123 } as Stats));
	});

	it('should generate NGINX configuration', () => {
		const result = buildNginxConf(mockFiles, mockResponses);
		expect(readFileSync).toHaveBeenCalledTimes(1);
		expect(result).toBe('/a.bin,/path/to/local/a.bin;/b.bin,/path/to/local/b.bin;#/c.txt,abc;/d.txt,xyz;');
	});
});
