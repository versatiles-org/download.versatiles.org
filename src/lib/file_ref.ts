import { readdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

export class FileRef {
	public fullname: string;
	public filename: string;
	public url: string;
	public readonly size: number;
	public readonly sizeString: string;
	public hashes?: { md5: string, sha: string };

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
		if (!this.hashes) throw Error();
		return this.hashes.md5;
	}
	get sha(): string {
		if (!this.hashes) throw Error();
		return this.hashes.sha;
	}
	clone(): FileRef {
		return new FileRef(this);
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
