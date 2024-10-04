/*
4. **Generate HTML File List**:
	 - Create a user-friendly HTML page that lists all available files, including:
		 - File names
		 - Sizes
		 - Hashes
		 - Download links
	 - Link the latest file to the local copy on the VM.
	 - Link older files to the versions served directly from the cloud storage.
*/

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Handlebars from 'handlebars';
import type { FileGroup } from './file_group.js';
import { FileRef } from './file_ref.js';

export function generateHTML(fileGroups: FileGroup[], filename: string): FileRef {
	console.log('generate html');

	const templateFilename = resolve(import.meta.dirname, '../../template/index.html');
	const template = Handlebars.compile(readFileSync(templateFilename, 'utf-8'));
	const html = template({ fileGroups });
	writeFileSync(filename, html);

	return new FileRef(filename, '');
}