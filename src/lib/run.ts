import { resolve } from 'node:path';
import { generateHashes, generateLists } from './hashes.js';
import { generateHTML } from './html.js';
import { getAllFiles } from './file_ref.js';
import { collectFiles, downloadLocalFiles, groupFiles } from './file_group.js';
import { generateNGINX } from './nginx.js';

const volumeFolder = resolve(import.meta.dirname, '../../volumes');
const remoteFolder = resolve(volumeFolder, 'remote_files');
const localFolder = resolve(volumeFolder, 'local_files');
const nginxFolder = resolve(volumeFolder, 'nginx_conf');

const domain = process.env['DOMAIN'];
if (!domain) throw Error('missing $DOMAIN');
const baseURL = `https://${domain}/`;

export async function run() {
	const files = await getAllFiles(remoteFolder);

	if (files.length === 0) throw Error('no remote files found');

	await generateHashes(files);

	const fileGroups = groupFiles(files);

	await downloadLocalFiles(fileGroups, localFolder);

	const filesPublic = collectFiles(
		fileGroups,
		generateHTML(fileGroups, resolve(localFolder, 'index.html')),
		generateLists(fileGroups, baseURL, localFolder)
	).map(f => f.clone());
	filesPublic.forEach(f => f.move(volumeFolder, '/usr/share/nginx/'));

	generateNGINX(filesPublic, resolve(nginxFolder, 'nginx.conf'));
}
