import { resolve } from 'path';
import { getAllFiles } from './files.js';
import { generateHashes } from './hashes.js';

const remoteFolder = resolve(import.meta.dirname, '../../volumes/remote_files');

export async function run() {
	const files = getAllFiles(remoteFolder, /\.versatiles$/);
	await generateHashes(files);
	//const files = await updateFiles();
	//await generateHTML();
	//await generateLists();
	//await generateNGINX();
}