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

import Handlebars from 'handlebars';
import type { FileGroup } from './files.js';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

export function generateHTML(fileGroups: FileGroup[], filename: string) {
	const templateFilename = resolve(import.meta.dirname, '../../template/index.html');
	const template = Handlebars.compile(readFileSync(templateFilename, 'utf-8'));
	const html = template({ fileGroups });
	writeFileSync(filename, html);
}