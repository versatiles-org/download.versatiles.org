import { statSync } from 'fs';
import { basename } from 'path';
import { FileResponse } from './file_response.js';

/**
 * Represents a single file that is part of the download.versatiles.org catalog.
 *
 * A `FileRef` has several perspectives on the same file:
 * - `fullname`: a local path (for generated site assets) or, for remote files,
 *   the path on the Storage Box
 * - `filename`: the basename
 * - `url`: the path/key under which the file is exposed (R2 key / HTTP path)
 * - `remotePath`: the absolute path on the Storage Box (empty for local files)
 *
 * Construction is flexible to support the different call sites in the pipeline:
 *
 * - `new FileRef(fullname, url)`:
 *   Local file; size is read from the filesystem via `statSync`.
 * - `new FileRef(fullname, size)`:
 *   Local file with a known size; `url` defaults to `/basename`.
 * - `new FileRef(fullname, size, remotePath)`:
 *   Remote file (on the Storage Box) with a known size and remote path.
 * - `new FileRef(fileRef)`:
 *   Copy constructor that clones an existing instance.
 *
 * Hashes (`hashes.md5` / `hashes.sha256`) are optional and are typically populated
 * by the hash generation step. Accessing `md5` or `sha256` before they are set
 * throws to surface misconfigurations early.
 */
export class FileRef {
	/** Local path (generated assets) or path on the Storage Box (remote files). */
	public fullname: string;

	/** File name (basename of `fullname`). */
	public filename: string;

	/** Path/key under which the file is exposed (R2 key / HTTP path). */
	public url: string;

	/** Raw file size in bytes. */
	public readonly size: number;

	/** Human-readable size string (e.g. `"1.2 GB"`). */
	public readonly sizeString: string;

	/** Absolute path on the Storage Box (empty string for local files). */
	public remotePath: string;

	/** Optional precomputed hashes for integrity / checksum files. */
	public hashes?: { md5: string, sha256: string };

	constructor(fullname: string, url: string);
	constructor(fullname: string, size: number);
	constructor(fullname: string, size: number, remotePath: string);
	constructor(file: FileRef);
	constructor(a: FileRef | string, b?: number | string, c?: string) {
		if (typeof a === 'string') {
			this.fullname = a;
			this.filename = basename(a);
			if (typeof b === 'string') {
				// (fullname, url) — local file, size from the filesystem.
				this.url = b;
				this.size = statSync(a).size;
				this.remotePath = '';
			} else if (typeof b === 'number' && typeof c === 'string') {
				// (fullname, size, remotePath) — remote file on the Storage Box.
				this.url = '/' + this.filename;
				this.size = b;
				this.remotePath = c;
			} else if (typeof b === 'number') {
				// (fullname, size) — local file with a known size.
				this.url = '/' + this.filename;
				this.size = b;
				this.remotePath = '';
			} else {
				throw new Error('Invalid FileRef constructor arguments: expected (fullname, url:string), (fullname, size:number) or (fullname, size:number, remotePath:string).');
			}
		} else if (a instanceof FileRef) {
			this.fullname = a.fullname;
			this.filename = a.filename;
			this.url = a.url;
			this.size = a.size;
			this.remotePath = a.remotePath;
			this.hashes = a.hashes;
		} else {
			throw new Error('Invalid FileRef constructor arguments: expected a string path or an existing FileRef instance.');
		}

		this.sizeString = (this.size / (2 ** 30)).toFixed(1) + ' GB';

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
