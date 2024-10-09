import { cpSync, rmSync } from 'node:fs';
import { FileRef, getAllFilesRecursive } from './file_ref.js';
import { resolve } from 'node:path';
import { FileGroup } from './file_group.js';


export async function downloadLocalFiles(fileGroups: FileGroup[], localFolder: string) {
	const localFiles = fileGroups.flatMap(group =>
		(group.local && group.latestFile) ? [group.latestFile] : []
	);
	syncFiles(localFiles, getAllFilesRecursive(localFolder), localFolder);
}

export function syncFiles(remoteFiles: FileRef[], localFiles: FileRef[], localFolder: string) {
	console.log('Syncing files...');

	const deleteFiles = new Map(localFiles.map(f => [f.filename, f]));
	const copyFiles = new Map(remoteFiles.map(f => [f.filename, f]));

	for (const remoteFile of remoteFiles) {
		const { filename } = remoteFile;
		const localFile = deleteFiles.get(filename);
		if (localFile && localFile.size === remoteFile.size) {
			copyFiles.delete(filename);
			deleteFiles.delete(filename);
			remoteFile.fullname = localFile.fullname;
		}
	}

	for (const file of deleteFiles.values()) {
		console.log(` - Deleting "${file.filename}"`);
		rmSync(file.fullname);
	}

	for (const file of copyFiles.values()) {
		const fullname = resolve(localFolder, file.filename);
		console.log(` - Copying "${file.filename}"`);
		cpSync(file.fullname, fullname);
		file.fullname = fullname; // Update the file's fullname to reflect its new location
	}
}
