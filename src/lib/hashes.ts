/*
- **Hash Generation**:
- Generate missing hashes (e.g., MD5, SHA256) for files in the remote storage.
*/

import { createReadStream, existsSync, writeFileSync } from 'fs';
import type { File } from './files.js';
import { ProgressBar } from 'work-faster';
import { createHash } from 'crypto';

export async function generateHashes(files: File[]) {
	files = files.filter(f => {
		if (missing('sha256')) return true;
		if (missing('md5')) return true;
		return false;

		function missing(type: string): boolean {
			const fullname = f.fullname + '.' + type;
			if (!existsSync(fullname)) return true;
			return false;
		}
	})

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
		writeFileSync(fullname + '.md5', md5.digest('hex'));
		writeFileSync(fullname + '.sha256', sha.digest('hex'));
	}
}
