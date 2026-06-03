import { describe, it, expect } from 'vitest';
import { FileResponse } from './file_response.js';

describe('FileResponse', () => {
	it('stores raw content and defaults to text/plain', () => {
		const r = new FileResponse('/foo.md5', 'abc foo\n');
		expect(r.url).toBe('/foo.md5');
		expect(r.content).toBe('abc foo\n'); // raw, not escaped
		expect(r.contentType).toBe('text/plain');
	});

	it('accepts an explicit content type', () => {
		const r = new FileResponse('/index.html', '<html></html>', 'text/html');
		expect(r.contentType).toBe('text/html');
	});

	it('requires the url to start with a slash', () => {
		expect(() => new FileResponse('foo', 'bar')).toThrow(/must start with/);
	});
});
