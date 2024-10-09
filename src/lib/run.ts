import { resolve } from 'node:path';
import { generateHashes, generateLists } from './hashes.js';
import { generateHTML } from './html.js';
import { getAllFilesRecursive } from './file_ref.js';
import { collectFiles, groupFiles } from './file_group.js';
import { generateNginxConf } from './nginx.js';
import { downloadLocalFiles } from './sync.js';


export async function run() {
	const volumeFolder = resolve(import.meta.dirname, '../../volumes/');
	const remoteFolder = resolve(volumeFolder, 'remote_files');
	const localFolder = resolve(volumeFolder, 'local_files');
	const nginxFolder = resolve(volumeFolder, 'nginx_conf');

	const domain = process.env['DOMAIN'];
	if (domain == null) throw Error('missing $DOMAIN');
	const baseURL = `https://${domain}/`;

	// -----

	const files = getAllFilesRecursive(remoteFolder);

	if (files.length === 0) throw Error('no remote files found');

	await generateHashes(files, remoteFolder);

	const fileGroups = groupFiles(files);

	await downloadLocalFiles(fileGroups, localFolder);

	const filesPublic = collectFiles(
		fileGroups,
		generateHTML(fileGroups, resolve(localFolder, 'index.html')),
		generateLists(fileGroups, baseURL, localFolder)
	).map(f => f.cloneMoved(volumeFolder, '/volumes/'));

	const confFilename = resolve(nginxFolder, 'site-confs/default.conf');
	generateNginxConf(filesPublic, confFilename);
}
