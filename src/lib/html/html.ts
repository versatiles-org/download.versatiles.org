import { readFileSync, writeFileSync } from 'node:fs';
import Handlebars from 'handlebars';
import type { FileGroup } from '../file/file_group.js';
import { FileRef } from '../file/file_ref.js';

export function buildHTML(fileGroups: FileGroup[]): string {
	const templateFilename = new URL('../../../template/index.html', import.meta.url).pathname;
	const template = Handlebars.compile(readFileSync(templateFilename, 'utf-8'));
	return template({ fileGroups });
}

export function generateHTML(fileGroups: FileGroup[], filename: string): FileRef {
	console.log('Generating HTML...');
	writeFileSync(filename, buildHTML(fileGroups));

	return new FileRef(filename, 'index.html');
}
