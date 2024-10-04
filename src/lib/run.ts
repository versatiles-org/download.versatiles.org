import { resolve } from 'node:path';
import { generateHashes, generateLists } from './hashes.js';
import { generateHTML } from './html.js';
import { getAllFiles } from './file_ref.js';
import { collectFiles, downloadLocalFiles, groupFiles } from './file_group.js';

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

	const filesPublic = collectFiles(
		fileGroups,
		generateHTML(fileGroups, resolve(localFolder, 'index.html')),
		generateLists(fileGroups, baseURL, localFolder)
	);

	console.log(filesPublic);

	//generateNGINX(filesPublic);
}