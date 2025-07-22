import { readdirSync, statSync } from 'fs';
import { basename, join, relative, resolve } from 'path';
import { FileResponse } from './file_response.js';

export class FileRef {
	public fullname: string;
	public filename: string;
	public url: string;
	public readonly size: number;
	public readonly sizeString: string;
	public hashes?: { md5: string, sha256: string };

	constructor(fullname: string, url: string);
	constructor(fullname: string, size: number);
	constructor(file: FileRef);
	constructor(a: FileRef | string, b?: number | string) {
		if (typeof a === 'string') {
			this.fullname = a;
			this.filename = basename(a);
			if (typeof b === 'string') {
				this.url = b;
				this.size = statSync(a).size;
			} else if (typeof b === 'number') {
				this.url = this.filename;
				this.size = b;
			} else {
				throw Error();
			}
		} else if (a instanceof FileRef) {
			this.fullname = a.fullname;
			this.filename = a.filename;
			this.url = a.url;
			this.size = a.size;
			this.hashes = a.hashes;
		} else {
			throw Error();
		}
		this.sizeString = (this.size / (2 ** 30)).toFixed(1) + ' GB';
	}
	get md5(): string {
		if (!this.hashes) throw Error(`MD5 hash is missing for file "${this.filename}"`);
		return this.hashes.md5;
	}
	get sha256(): string {
		if (!this.hashes) throw Error(`SHA256 hash is missing for file "${this.filename}"`);
		return this.hashes.sha256;
	}
	getResponseMd5File(): FileResponse {
		return new FileResponse(`${this.url}.md5`, `${this.md5} ${basename(this.url)}\n`);
	}
	getResponseSha256File(): FileResponse {
		return new FileResponse(`${this.url}.sha256`, `${this.sha256} ${basename(this.url)}\n`);
	}
	clone(): FileRef {
		return new FileRef(this);
	}
	cloneMoved(from: string, to: string): FileRef {
		const f = new FileRef(this);
		f.fullname = join(to, relative(from, f.fullname));
		return f;
	}
}

export function getAllFilesRecursive(folderPath: string): FileRef[] {
	return rec(folderPath).sort((a, b) => a.fullname.localeCompare(b.fullname));

	function rec(folderPath: string): FileRef[] {
		const files: FileRef[] = [];
		const filenames = readdirSync(folderPath);
		for (const filename of filenames) {
			const fullPath = resolve(folderPath, filename);
			if (statSync(fullPath).isDirectory()) {
				files.push(...rec(fullPath)); // Recursive call for subdirectory
			} else if (filename.endsWith('.versatiles')) {
				files.push(new FileRef(fullPath, filename));
			}
		}
		return files;
	}
}
