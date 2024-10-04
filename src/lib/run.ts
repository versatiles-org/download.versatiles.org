import { resolve } from 'node:path';
import { downloadLocalFiles, getAllFiles, groupFiles } from './files.js';
import { generateHashes, generateLists } from './hashes.js';
import { generateHTML } from './html.js';

const remoteFolder = resolve(import.meta.dirname, '../../volumes/remote_files');
const localFolder = resolve(import.meta.dirname, '../../volumes/local_files');
const domain = process.env['DOMAIN'];
if (!domain) throw Error('missing $DOMAIN');
const baseURL = `https://${domain}/`;

export async function run() {
	const files = await getAllFiles(remoteFolder);

	await generateHashes(files);

	const fileGroups = groupFiles(files);

	await downloadLocalFiles(fileGroups, localFolder);

	generateHTML(fileGroups, resolve(localFolder, 'index.html'));

	await generateLists(fileGroups, baseURL, localFolder);
	//await generateNGINX();
}