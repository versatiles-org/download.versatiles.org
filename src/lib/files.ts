import { BunnyFile } from './bunny_storage.js';

export interface Redirect {
	link: string;
	file: BunnyFile;
}

export function getLatestFiles(files: BunnyFile[]): Redirect[] {
	files.sort((a, b) => a.filename.localeCompare(b.filename));
	const filenames = new Set<string>();
	const latest = new Map<string, BunnyFile>();
	files.forEach(file => {
		const { filename } = file;
		if (!filename.endsWith('.versatiles')) return;
		filenames.add(filename);
		if (!/\.\d{8}\.versatiles$/.test(filename)) return;
		latest.set(filename.slice(0, -20) + '.versatiles', file);
	})

	const redirects = Array.from(latest.entries()).map(([filename, file]) => {
		files.push({ ...file, filename })
		return { link: filename, file }
	})

	return redirects;
}

export function buildUrlList(files: Redirect[]): Buffer {
	console.log(files);
	throw Error();

	//TsvHttpData-1.0
	//https://download.versatiles.org/planet-latest.versatiles	57615485619	58C2MYeMwqk4N0pbuefCOg==

}