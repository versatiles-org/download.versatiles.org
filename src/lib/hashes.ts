/*
- **Hash Generation**:
- Generate missing hashes (e.g., MD5, SHA256) for files in the remote storage.
*/

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { FileGroup } from './file_group.js';
import { FileRef } from './file_ref.js';
import Handlebars from 'handlebars';
import { ProgressBar } from 'work-faster';
import { spawnSync } from 'node:child_process';

export async function generateHashes(files: FileRef[], remoteFolder: string) {
	const todos: { file: FileRef, hashName: string }[] = [];

	console.log('Check hashes...');
	files.forEach(file => {
		const fullnameMD5 = file.fullname + '.md5';
		if (!existsSync(fullnameMD5)) todos.push({ file, hashName: 'md5' });

		const fullnameSHA = file.fullname + '.sha256';
		if (!existsSync(fullnameSHA)) todos.push({ file, hashName: 'sha256' });
	})

	if (todos.length > 0) {
		console.log(' - Calculate hashes...');

		const sum = todos.reduce((s, t) => s + t.file.size, 0);
		const progress = new ProgressBar(sum);

		for (const todo of todos) {
			const { file, hashName } = todo;
			const path = resolve('/home/', relative(remoteFolder, todo.file.fullname));
			const args = [
				process.env['STORAGE_URL'] ?? 'STORAGE_URL is missing',
				'-p', '23',
				'-i', '.ssh/storage',
				'-oBatchMode=yes',
				hashName + 'sum',
				path
			]
			const result = spawnSync('ssh', args);
			if (result.stderr.length > 0) throw Error(result.stderr.toString());
			const hashString = result.stdout.toString().replace(/\s.*\//, ' ');
			writeFileSync(file.fullname + '.' + hashName, hashString);
			progress.increment(file.size);
		}
	}

	console.log('Read hashes...');
	files.forEach(f => {
		f.hashes = {
			md5: read('md5'),
			sha: read('sha256'),
		};
		function read(hash: string): string {
			return readFileSync(f.fullname + '.' + hash, 'utf8').replace(/\s.*/, '')
		}
	})
}

export function generateLists(fileGroups: FileGroup[], baseURL: string, localFolder: string): FileRef[] {
	console.log('Generating url lists...');

	const templateFilename = new URL('../../template/urllist.tsv', import.meta.url).pathname;
	const template = Handlebars.compile(readFileSync(templateFilename, 'utf-8'));
	const listFiles: FileRef[] = [];

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

		listFiles.push(new FileRef(fullname, filename));
	}

	return listFiles;
}

export function hex2base64(hex: string): string {
	const base64 = Buffer.from(hex, 'hex').toString('base64url');
	return base64 + '='.repeat((4 - (base64.length % 4)) % 4);
}
