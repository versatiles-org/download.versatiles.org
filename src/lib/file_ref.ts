import { statSync } from 'node:fs';
import { cp, readdir, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

export class FileRef {
	public fullname: string;
	public filename: string;
	public url: string;
	public size: number;
	private hashes?: { md5: string, sha: string };

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
		} else if (isFileRef(a)) {
			this.fullname = a.fullname;
			this.filename = a.filename;
			this.url = a.url;
			this.size = a.size;
			this.hashes = a.hashes;
		} else {
			throw Error();
		}
	}
	get sizeString(): string {
		return (this.size / (2 ** 30)).toFixed(1) + ' GB';
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
	setHashes(hashes: { md5: string, sha: string }) {
		this.hashes = hashes;
	}
}

export function isFileRef(entry: unknown): entry is FileRef {
	return (
		(entry != null) &&
		(typeof entry === 'object') &&
		('fullname' in entry && typeof entry.fullname == 'string') &&
		('filename' in entry && typeof entry.filename == 'string') &&
		('url' in entry && typeof entry.url == 'string') &&
		('size' in entry && typeof entry.size == 'number') &&
		('sizeString' in entry && typeof entry.sizeString == 'string'));
}

export async function getAllFiles(folder: string): Promise<FileRef[]> {
	const files: FileRef[] = [];
	try {
		const filenames = await readdir(folder);
		for (const filename of filenames) {
			if (!filename.endsWith('.versatiles')) continue;
			const fullname = resolve(folder, filename);
			files.push(new FileRef(fullname, filename));
		}
	} catch (error) {
		console.error(`Failed to read files in folder "${folder}": ${error}`);
	}
	return files;
}


export async function syncFiles(remoteFiles: FileRef[], localFiles: FileRef[], localFolder: string): Promise<void> {
	console.log('syncing files');

	const deleteFiles = new Map(localFiles.map(f => [f.filename, f]));
	const copyFiles = new Map(remoteFiles.map(f => [f.filename, f]));

	for (const remoteFile of remoteFiles) {
		const { filename } = remoteFile;
		const localFile = deleteFiles.get(filename);
		if (localFile && localFile.size === remoteFile.size) {
			copyFiles.delete(filename);
			deleteFiles.delete(filename);
		}
	}

	try {
		for (const file of deleteFiles.values()) {
			console.log(`Deleting "${file.filename}"`);
			await rm(file.fullname);
		}

		for (const file of copyFiles.values()) {
			const fullname = resolve(localFolder, file.filename);
			console.log(`Copying "${file.filename}"`);
			await cp(file.fullname, fullname);
			file.fullname = fullname; // Update the file's fullname to reflect its new location
		}
	} catch (error) {
		console.error(`Failed to sync files: ${error}`);
	}
}
