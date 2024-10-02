import { resolve } from 'path';
import { syncFiles, getAllFiles, groupFiles } from './files.js';
import { generateHashes } from './hashes.js';
import { generateHTML } from './html.js';

const remoteFolder = resolve(import.meta.dirname, '../../volumes/remote_files');
const localFolder = resolve(import.meta.dirname, '../../volumes/local_files');

export async function run() {
	const files = await getAllFiles(remoteFolder);

	await generateHashes(files);

	const fileGroups = groupFiles(files);

	const localFiles = fileGroups.flatMap(group =>
		(group.local && group.latestFile) ? [group.latestFile] : []
	);
	syncFiles(localFiles, await getAllFiles(localFolder), localFolder)

	generateHTML(fileGroups, resolve(localFolder, 'index.html'));
	//await generateLists();
	//await generateNGINX();
}