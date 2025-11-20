import { readFileSync, writeFileSync } from 'fs';
import Handlebars from 'handlebars';
import type { FileGroup } from '../file/file_group.js';
import { FileRef } from '../file/file_ref.js';

export function compileTemplate(fileGroups: FileGroup[], templateFilename: string): string {
	const templateUrl = new URL(`../../../template/${templateFilename}`, import.meta.url);
	const template = Handlebars.compile(readFileSync(templateUrl, 'utf-8'));
	return template({ fileGroups });
}

export function generateHTML(fileGroups: FileGroup[], filename: string): FileRef {
	console.log('Generating HTML...');
	writeFileSync(filename, compileTemplate(fileGroups, "index.html"));

	return new FileRef(filename, 'index.html');
}
