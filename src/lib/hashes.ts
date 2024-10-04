/*
- **Hash Generation**:
- Generate missing hashes (e.g., MD5, SHA256) for files in the remote storage.
*/

import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { FileGroup } from './file_group.js';
import { FileRef } from './file_ref.js';
import Handlebars from 'handlebars';
import { ProgressBar } from 'work-faster';

export async function generateHashes(files: FileRef[]) {
	console.log('check hashes');
	files = files.filter(f => {
		const fullnameMD5 = f.fullname + '.md5';
		const fullnameSHA = f.fullname + '.sha256';

		if (!existsSync(fullnameMD5)) return true;
		if (!existsSync(fullnameSHA)) return true;

		f.hashes = {
			md5: readFileSync(fullnameMD5, 'utf8'),
			sha: readFileSync(fullnameSHA, 'utf8'),
		};

		return false;
	})

	if (files.length === 0) return;
	console.log('calculate hashes');

	const sum = files.reduce((s, f) => s + f.size, 0);
	const progress = new ProgressBar(sum);

	for (const file of files) {
		const md5 = createHash('md5');
		const sha = createHash('sha256');
		const { fullname } = file;
		await new Promise(r => createReadStream(fullname, { highWaterMark: 1024 + 1024 })
			.on('data', chunk => {
				progress.increment(chunk.length);
				md5.update(chunk);
				sha.update(chunk);
			}).on('close', r)
		)
		const fullnameMD5 = fullname + '.md5';
		const fullnameSHA = fullname + '.sha256';

		file.hashes = {
			md5: md5.digest('hex'),
			sha: sha.digest('hex'),
		};

		writeFileSync(fullnameMD5, file.md5);
		writeFileSync(fullnameSHA, file.sha);
	}
}

export function generateLists(fileGroups: FileGroup[], baseURL: string, localFolder: string): FileRef[] {
	console.log('Generating url lists...');

	const templateFilename = new URL('../../template/urllist.tsv', import.meta.url).pathname;
	const template = Handlebars.compile(readFileSync(templateFilename, 'utf-8'));
	const files: FileRef[] = [];

	for (const fileGroup of fileGroups) {
		const { latestFile } = fileGroup;
		if (latestFile == null) continue;
		if (!latestFile.md5) throw Error();
		if (!latestFile.sha) throw Error();

		const files = [{
			url: baseURL + '/' + latestFile.url,
			size: latestFile.size,
			md5: hex2base64(latestFile.md5),
			sha: hex2base64(latestFile.sha),
		}]

		const text = template({ files });
		const filename = fileGroup.slug + '.tsv';
		const fullname = resolve(localFolder, filename);

		writeFileSync(fullname, text);

		files.push(new FileRef(fullname, filename));
	}

	return files;
}

export function hex2base64(hex: string): string {
	const base64 = Buffer.from(hex, 'hex').toString('base64url');
	return base64 + '='.repeat((4 - (base64.length % 4)) % 4);
}
