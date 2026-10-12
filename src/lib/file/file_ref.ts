import { basename } from 'path';
import { FileResponse } from './file_response.js';

/**
 * Represents a single data file of the download.versatiles.org catalog: a
 * `.versatiles` file on the Storage Box that is, or is about to be, published
 * on R2.
 *
 * A `FileRef` has several perspectives on the same file:
 * - `remotePath` / `fullname`: the absolute path on the Storage Box
 * - `filename`: the basename
 * - `url`: the path/key under which the file is exposed (R2 key / HTTP path)
 *
 * Construction:
 *
 * - `new FileRef(fullname, size, remotePath)`:
 *   a file on the Storage Box with a known size.
 * - `new FileRef(fileRef)`:
 *   copy constructor that clones an existing instance.
 *
 * Hashes (`hashes.md5` / `hashes.sha256`) are optional and are typically populated
 * by the hash generation step. Accessing `md5` or `sha256` before they are set
 * throws to surface misconfigurations early.
 */
export class FileRef {
	/** Path on the Storage Box. */
	public fullname: string;

	/** File name (basename of `fullname`). */
	public filename: string;

	/** Path/key under which the file is exposed (R2 key / HTTP path). */
	public url: string;

	/** Raw file size in bytes. */
	public readonly size: number;

	/** Human-readable size string (e.g. `"1.2 GB"`). */
	public readonly sizeString: string;

	/** Absolute path on the Storage Box. */
	public remotePath: string;

	/** Optional precomputed hashes for integrity / checksum files. */
	public hashes?: { md5: string; sha256: string };

	constructor(fullname: string, size: number, remotePath: string);
	constructor(file: FileRef);
	constructor(a: FileRef | string, b?: number, c?: string) {
		if (typeof a === 'string' && typeof b === 'number' && typeof c === 'string') {
			this.fullname = a;
			this.filename = basename(a);
			this.url = '/' + this.filename;
			this.size = b;
			this.remotePath = c;
		} else if (a instanceof FileRef) {
			this.fullname = a.fullname;
			this.filename = a.filename;
			this.url = a.url;
			this.size = a.size;
			this.remotePath = a.remotePath;
			this.hashes = a.hashes;
		} else {
			throw new Error(
				'Invalid FileRef constructor arguments: expected (fullname, size:number, remotePath:string) or an existing FileRef instance.',
			);
		}

		this.sizeString = formatSize(this.size);

		if (!/^\/[^/]/.test(this.url)) {
			throw new Error(`FileRef.url must start with a single '/', got: ${this.url}`);
		}
	}

	/**
	 * Returns the MD5 hash of the file.
	 *
	 * Throws if hashes have not been assigned yet. This usually means the
	 * hash generation step has not been executed or did not include this file.
	 */
	get md5(): string {
		if (!this.hashes) throw Error(`MD5 hash is missing for file "${this.filename}"`);
		return this.hashes.md5;
	}

	/**
	 * Returns the SHA256 hash of the file.
	 *
	 * Throws if hashes have not been assigned yet. This usually means the
	 * hash generation step has not been executed or did not include this file.
	 */
	get sha256(): string {
		if (!this.hashes) throw Error(`SHA256 hash is missing for file "${this.filename}"`);
		return this.hashes.sha256;
	}

	/**
	 * Builds a virtual `.md5` checksum file for this file.
	 * The content follows the standard `<hash> <filename>` format.
	 */
	getResponseMd5File(): FileResponse {
		return new FileResponse(`${this.url}.md5`, `${this.md5} ${basename(this.url)}\n`);
	}

	/**
	 * Builds a virtual `.sha256` checksum file for this file.
	 * The content follows the standard `<hash> <filename>` format.
	 */
	getResponseSha256File(): FileResponse {
		return new FileResponse(`${this.url}.sha256`, `${this.sha256} ${basename(this.url)}\n`);
	}

	/** Creates a shallow copy of this FileRef, including hashes if present. */
	clone(): FileRef {
		return new FileRef(this);
	}
}

/**
 * Formats a file size in the unit that suits it: MB below 1 GB, TB from
 * 1024 GB, GB in between. Units are binary (1 GB = 2^30 bytes).
 */
export function formatSize(bytes: number): string {
	if (bytes < 2 ** 30) return (bytes / 2 ** 20).toFixed(1) + ' MB';
	if (bytes < 2 ** 40) return (bytes / 2 ** 30).toFixed(1) + ' GB';
	return (bytes / 2 ** 40).toFixed(2) + ' TB';
}
