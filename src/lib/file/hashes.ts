/*
- **Hash Generation**:
- Generate missing hashes (e.g., MD5, SHA256) for files in the remote storage.
*/

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { relative, resolve } from 'path';
import { FileRef } from './file_ref.js';
import { ProgressBar } from 'work-faster';
import { spawnSync } from 'child_process';

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
			sha256: read('sha256'),
		};
		function read(hash: string): string {
			return readFileSync(f.fullname + '.' + hash, 'utf8').replace(/\s.*/ms, '')
		}
	})
}
