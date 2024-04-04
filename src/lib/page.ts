
import Handlebars from 'handlebars';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { normalize, resolve } from 'node:path';
import { BunnyFile } from './bunny_storage.js';

export function buildPage(files: BunnyFile[]): Buffer {
	console.log(files);
	throw Error();
	process.exit();
	const dirname = new URL('.', import.meta.url).pathname;
	const path = normalize(process.argv[2] ?? dirname);
	const KB = 1024;
	const MB = 1024 * 1024;
	const GB = 1024 * 1024 * 1024;

	const fildddes = readdirSync(path).flatMap(name => {
		if (!name.endsWith('.versatiles')) return [];
		const fullname = resolve(path, name);
		const stat = statSync(fullname);
		let size;
		if (stat.size < KB) {
			size = stat.size + ' B';
		} else if (stat.size < MB) {
			size = (stat.size / KB).toFixed(1) + ' KB';
		} else if (stat.size < GB) {
			size = (stat.size / MB).toFixed(1) + ' MB';
		} else {
			size = (stat.size / GB).toFixed(1) + ' GB';
		}
		return {
			name,
			size,
		}
	}).sort((a, b) => a.name.localeCompare(b.name));

	const template = Handlebars.compile(readFileSync(resolve(dirname, 'template.html'), 'utf8'));
	const index = template({ files });
	writeFileSync(resolve(dirname, 'docs/index.html'), index);

}
