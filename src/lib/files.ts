import { readdir, stat, cp, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

export interface FileGroup {
	title: string;
	order: number;
	local: boolean;
	latestFile?: File;
	olderFiles: File[];
}

export interface File {
	fullname: string;
	filename: string;
	size: number;
}

export async function getAllFiles(folder: string): Promise<File[]> {
	const files: File[] = [];
	try {
		const filenames = await readdir(folder);
		for (const filename of filenames) {
			if (!filename.endsWith('.versatiles')) continue;
			const fullname = resolve(folder, filename);
			const { size } = await stat(fullname);
			files.push({ fullname, filename, size });
		}
	} catch (error) {
		console.error(`Failed to read files in folder "${folder}": ${error}`);
	}
	return files;
}

export function groupFiles(files: File[]): FileGroup[] {
	const groupMap = new Map<string, FileGroup>();
	files.forEach(file => {
		const groupName = basename(file.filename).replace(/\..*/, '');
		let group = groupMap.get(groupName);

		if (!group) {
			let title = '?';
			let order = 10000;
			let local = false;
			switch (groupName) {
				case 'osm':
					title = 'OpenStreetMap as vector tiles';
					order = 0;
					local = true;
					break;
				case 'hillshade-vectors':
					title = 'Hillshading as vector tiles';
					order = 10;
					break;
				default:
					console.error(`Unknown group "${groupName}"`);
			}

			group = { title, order, local, olderFiles: [] };
			groupMap.set(groupName, group);
		}

		group.olderFiles.push(file);
	});

	const groupList = Array.from(groupMap.values());

	groupList.sort((a, b) => a.order - b.order);

	groupList.forEach(group => {
		group.olderFiles.sort((a, b) => a.filename < b.filename ? 1 : -1);
		group.latestFile = group.olderFiles.shift();
	});

	return groupList;
}

export async function syncFiles(remoteFiles: File[], localFiles: File[], localFolder: string): Promise<void> {
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
