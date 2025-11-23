import { readFileSync, writeFileSync } from 'fs';
import Handlebars from 'handlebars';
import type { FileGroup } from '../file/file_group.js';
import { FileRef } from '../file/file_ref.js';
import { resolve } from 'path';

export function renderTemplate(fileGroups: FileGroup[], templateFilename: string): string {
	const templateUrl = new URL(`../../../template/${templateFilename}`, import.meta.url);
	const template = Handlebars.compile(readFileSync(templateUrl, 'utf-8'));
	return template({ fileGroups });
}

export function generateHTML(fileGroups: FileGroup[], filename: string): FileRef {
	console.log('Generating HTML...');
	writeFileSync(filename, renderTemplate(fileGroups, "index.html"));

	return new FileRef(filename, '/index.html');
}

export function generateRSSFeeds(fileGroups: FileGroup[], outputDir: string): FileRef[] {
	console.log('Generating RSS feeds...');
	const refs: FileRef[] = []

	fileGroups.forEach(g => {
		const filename = `feed-${g.slug}.xml`
		const outputPath = resolve(outputDir, filename)
		writeFileSync(outputPath, renderTemplate([g], "feed.xml"));
		refs.push(new FileRef(outputPath, '/'+filename))
	})

	return refs;
}
