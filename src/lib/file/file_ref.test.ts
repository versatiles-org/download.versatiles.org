import { describe, it, expect } from 'vitest';
import { FileRef } from './file_ref.js';
import { FileResponse } from './file_response.js';

describe('FileRef', () => {
	it('should create a FileRef with correct properties from a path and size', () => {
		const fileRef = new FileRef('/path/file.versatiles', 200);
		expect(fileRef.fullname).toBe('/path/file.versatiles');
		expect(fileRef.filename).toBe('file.versatiles');
		expect(fileRef.size).toBe(200);
		expect(fileRef.url).toBe('/file.versatiles');
		expect(fileRef.remotePath).toBe('');
	});

	it('should create a remote FileRef with a remotePath', () => {
		const fileRef = new FileRef('/home/osm/osm.versatiles', 500, '/home/osm/osm.versatiles');
		expect(fileRef.fullname).toBe('/home/osm/osm.versatiles');
		expect(fileRef.filename).toBe('osm.versatiles');
		expect(fileRef.size).toBe(500);
		expect(fileRef.url).toBe('/osm.versatiles');
		expect(fileRef.remotePath).toBe('/home/osm/osm.versatiles');
	});

	it('should clone a FileRef object', () => {
		const fileRef = new FileRef('/home/osm/osm.versatiles', 500, '/home/osm/osm.versatiles');
		const clonedFileRef = fileRef.clone();
		expect(clonedFileRef).not.toBe(fileRef); // Ensure it's a new object
		expect(clonedFileRef).toEqual(fileRef); // Ensure the content is the same
	});

	it('should calculate sizeString correctly', () => {
		const fileRef = new FileRef('/path/file.versatiles', 1024 * 1024 * 1024); // 1 GB
		expect(fileRef.sizeString).toBe('1.0 GB');
	});

	it('should throw an error when accessing hashes without setting them', () => {
		const fileRef = new FileRef('/path/file.versatiles', 200);
		expect(() => fileRef.md5).toThrow();
		expect(() => fileRef.sha256).toThrow();
	});

	it('should return hashes', () => {
		const fileRef = new FileRef('/path/file.versatiles', 200);
		fileRef.hashes = { md5: 'abc', sha256: 'xyz' };
		expect(fileRef.md5).toBe('abc');
		expect(fileRef.sha256).toBe('xyz');
	});

	it('should return hash responses', () => {
		const fileRef = new FileRef('/path/file.versatiles', 200);
		fileRef.hashes = { md5: 'abc', sha256: 'xyz' };
		expect(fileRef.getResponseMd5File())
			.toStrictEqual(new FileResponse('/file.versatiles.md5', 'abc file.versatiles\n'));
		expect(fileRef.getResponseSha256File())
			.toStrictEqual(new FileResponse('/file.versatiles.sha256', 'xyz file.versatiles\n'));
	});

	it('should throw for invalid constructor arguments', () => {
		// @ts-expect-error testing invalid runtime usage
		expect(() => new FileRef(123)).toThrow();
	});
});
