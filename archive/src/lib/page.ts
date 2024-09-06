
import Handlebars from 'handlebars';
import { readFileSync } from 'node:fs';
import { BunnyFile } from './bunny_storage.js';



const filenameTemplate = new URL('../../html/index.html', import.meta.url).pathname;
const template = Handlebars.compile(readFileSync(filenameTemplate, 'utf8'));

export function buildPage(fileList: BunnyFile[]): Buffer {
	const KB = 1024;
	const MB = 1024 * 1024;
	const GB = 1024 * 1024 * 1024;

	const files = fileList.flatMap(file => {
		if (!file.name.endsWith('.versatiles')) return [];
		let size;
		if (file.size < KB) {
			size = file.size + ' B';
		} else if (file.size < MB) {
			size = (file.size / KB).toFixed(1) + ' KB';
		} else if (file.size < GB) {
			size = (file.size / MB).toFixed(1) + ' MB';
		} else {
			size = (file.size / GB).toFixed(1) + ' GB';
		}
		return {
			name: file.name,
			size,
		}
	}).sort((a, b) => a.name.localeCompare(b.name));

	return Buffer.from(template({ files }));
}
