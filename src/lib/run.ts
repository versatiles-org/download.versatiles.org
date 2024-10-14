import { resolve } from 'node:path';
import { getAllFilesRecursive } from './file/file_ref.js';
import { collectFiles, groupFiles } from './file/file_group.js';
import { generateHashes } from './file/hashes.js';
import { downloadLocalFiles } from './file/sync.js';
import { generateHTML } from './html/html.js';
import { generateNginxConf } from './nginx/nginx.js';
import { FileResponse } from './file/file_response.js';

export interface Options {
	domain?: string;
	volumeFolder?: string;
}

export async function run(options: Options = {}) {
	// Define key folder paths for the volumes, remote, local files, and Nginx configuration.
	const volumeFolder = options.volumeFolder ?? new URL('../../volumes/', import.meta.url).pathname;
	const remoteFolder = resolve(volumeFolder, 'remote_files'); // Folder containing remote files.
	const localFolder = resolve(volumeFolder, 'local_files'); // Folder for downloaded local files.
	const nginxFolder = resolve(volumeFolder, 'nginx_conf'); // Folder for the generated Nginx config.

	// Get the domain from environment variables. Throw an error if it's not set.
	const domain = options.domain ?? process.env['DOMAIN'];
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
	const publicFiles = collectFiles(
		fileGroups,
		// `generateHTML` creates index.html and returns a FileRef
		generateHTML(fileGroups, resolve(localFolder, 'index.html')),
	).map(f => f.cloneMoved(volumeFolder, '/volumes/'));
	// FileRefs are cloned and their paths "moved" so they have to correct paths in the Nginx configuration

	const publicResponses: FileResponse[] = fileGroups.flatMap(f => f.getResponses(baseURL));

	// Generate an Nginx configuration file and save it.
	const confFilename = resolve(nginxFolder, 'site-confs/default.conf');
	generateNginxConf(publicFiles, publicResponses, confFilename);
}
