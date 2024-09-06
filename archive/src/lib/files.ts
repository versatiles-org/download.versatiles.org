import { BunnyFile } from './bunny_storage.js';
import env from './env.js';

export interface Redirect {
	link: string;
	file: BunnyFile;
}


export function getLatestFileRedirects(files: BunnyFile[]): Redirect[] {
	files.sort((a, b) => a.name.localeCompare(b.name));
	const filenames = new Set<string>();
	const latest = new Map<string, BunnyFile>();
	files.forEach(file => {
		const { name } = file;
		if (!name.endsWith('.versatiles')) return;
		filenames.add(name);
		if (!/\.\d{8}\.versatiles$/.test(name)) return;
		latest.set(name.slice(0, -20) + '.versatiles', file);
	})

	const redirects = Array.from(latest.entries()).map(([filename, file]) => {
		files.push(file.getClone(filename));
		return { link: filename, file }
	})

	return redirects;
}

export async function buildUrlList(redirects: Redirect[]): Promise<Buffer> {
	const result = ['TsvHttpData-1.0\n'];
	for (const redirect of redirects) {
		const md5 = await redirect.file.getMd5();
		result.push([
			`https://${env.domain}/${redirect.link}`,
			redirect.file.size,
			Buffer.from(md5, 'hex').toString('base64'),
		].join('\t') + '\n');
	}
	return Buffer.from(result.join(''));
}