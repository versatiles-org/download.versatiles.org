import { describe, it, expect } from 'vitest';
import { FileRef, formatSize } from './file_ref.js';
import { FileResponse } from './file_response.js';

describe('FileRef', () => {
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
		const fileRef = new FileRef('/path/file.versatiles', 2 ** 30, '/path/file.versatiles'); // 1 GB
		expect(fileRef.sizeString).toBe('1.0 GB');
	});

	it('should throw an error when accessing hashes without setting them', () => {
		const fileRef = new FileRef('/path/file.versatiles', 200, '/path/file.versatiles');
		expect(() => fileRef.md5).toThrow();
		expect(() => fileRef.sha256).toThrow();
	});

	it('should return hashes', () => {
		const fileRef = new FileRef('/path/file.versatiles', 200, '/path/file.versatiles');
		fileRef.hashes = { md5: 'abc', sha256: 'xyz' };
		expect(fileRef.md5).toBe('abc');
		expect(fileRef.sha256).toBe('xyz');
	});

	it('should return hash responses', () => {
		const fileRef = new FileRef('/path/file.versatiles', 200, '/path/file.versatiles');
		fileRef.hashes = { md5: 'abc', sha256: 'xyz' };
		expect(fileRef.getResponseMd5File()).toStrictEqual(
			new FileResponse('/file.versatiles.md5', 'abc file.versatiles\n'),
		);
		expect(fileRef.getResponseSha256File()).toStrictEqual(
			new FileResponse('/file.versatiles.sha256', 'xyz file.versatiles\n'),
		);
	});

	it('should throw for invalid constructor arguments', () => {
		// @ts-expect-error testing invalid runtime usage
		expect(() => new FileRef(123)).toThrow();
		// @ts-expect-error a size alone is no longer enough: every file lives on the Storage Box
		expect(() => new FileRef('/path/file.versatiles', 200)).toThrow();
	});
});

describe('formatSize', () => {
	it.each([
		[714592965, '681.5 MB'], // bathymetry-vectors
		[2090202113, '1.9 GB'], // landcover-vectors
		[66534652244, '62.0 GB'], // osm
		[437112576488, '407.1 GB'], // elevation
		[1716911593666, '1.56 TB'], // satellite
	])('%d bytes → %s', (bytes, expected) => {
		expect(formatSize(bytes)).toBe(expected);
	});

	it('switches units exactly at 1 GB and at 1024 GB', () => {
		expect(formatSize(2 ** 30 - 1)).toBe('1024.0 MB');
		expect(formatSize(2 ** 30)).toBe('1.0 GB');
		expect(formatSize(2 ** 40 - 2 ** 20)).toBe('1024.0 GB');
		expect(formatSize(2 ** 40)).toBe('1.00 TB');
	});
});
