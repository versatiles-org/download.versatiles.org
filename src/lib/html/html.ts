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
import type { FileGroup } from '../file/file_group.js';
import { FileRef } from '../file/file_ref.js';

export function buildHTML(fileGroups: FileGroup[]): string {
	const templateFilename = resolve(import.meta.dirname, '../../../template/index.html');
	const template = Handlebars.compile(readFileSync(templateFilename, 'utf-8'));
	return template({ fileGroups });
}

export function generateHTML(fileGroups: FileGroup[], filename: string): FileRef {
	console.log('Generating HTML...');
	writeFileSync(filename, buildHTML(fileGroups));

	return new FileRef(filename, 'index.html');
}
