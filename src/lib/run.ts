import { resolve } from 'node:path';
import { getAllFilesRecursive } from './file/file_ref.js';
import { collectFiles, groupFiles } from './file/file_group.js';
import { generateHashes, generateLists } from './file/hashes.js';
import { downloadLocalFiles } from './file/sync.js';
import { generateHTML } from './html/html.js';
import { generateNginxConf } from './nginx/nginx.js';

export async function run() {
	// Define key folder paths for the volumes, remote, local files, and Nginx configuration.
	const volumeFolder = resolve(import.meta.dirname, '../../volumes/');
	const remoteFolder = resolve(volumeFolder, 'remote_files'); // Folder containing remote files.
	const localFolder = resolve(volumeFolder, 'local_files'); // Folder for downloaded local files.
	const nginxFolder = resolve(volumeFolder, 'nginx_conf'); // Folder for the generated Nginx config.

	// Get the domain from environment variables. Throw an error if it's not set.
	const domain = process.env['DOMAIN'];
	if (domain == null) throw Error('missing $DOMAIN');
	const baseURL = `https://${domain}/`;

	// Get a list of all files in the remote folder recursively.
	const files = getAllFilesRecursive(remoteFolder);

	// If no remote files are found, throw an error.
	if (files.length === 0) throw Error('no remote files found');

	// Generate hashes for the files located in the remote folder.
	await generateHashes(files, remoteFolder);

	// Group files based on their names.
	const fileGroups = groupFiles(files);

	// Download remote files to the local folder if needed.
	await downloadLocalFiles(fileGroups, localFolder);

	// Collect files to generate public-facing resources, like HTML and file lists.
	const filesPublic = collectFiles(
		fileGroups,
		// `generateHTML` creates index.html and returns a FileRef
		generateHTML(fileGroups, resolve(localFolder, 'index.html')),
		// `generateLists` produces urllist_*.tsv files and returns FileRefs
		generateLists(fileGroups, baseURL, localFolder)
	).map(f => f.cloneMoved(volumeFolder, '/volumes/'));
	// FileRefs are cloned and their paths "moved" so they have to correct paths in the Nginx configuration

	// Generate an Nginx configuration file and save it.
	const confFilename = resolve(nginxFolder, 'site-confs/default.conf');
	generateNginxConf(filesPublic, confFilename);
}
