/*
- **Hash Generation**:
- Generate missing hashes (e.g., MD5, SHA256) for files in the remote storage.
- Store these hashes locally for quick access and inclusion in the HTML file list.

*/

import { existsSync, statSync } from 'fs';
import type { File } from './files.js';

export async function generateHashes(files: File[]) {
	files = files.filter(f => {
		if (missing('sha256')) return true;
		if (missing('md5')) return true;
		return false;

		function missing(type: string): boolean {
			const fullname = f.fullname + '.' + type;
			if (!existsSync(fullname)) return true;
			if (statSync(fullname).mtime !== f.ctime) return true;
			return false;
		}
	})

	const sum = files.reduce((s, f) => s + f.size, 0);
	

	cat osm.20240325.versatiles | tee > (md5sum > osm.20240325.versatiles.md5) | sha256sum > osm.20240325.versatiles.sha256

}

curl - O http://example.com/file && (md5sum file > file.md5 & sha256sum file > file.sha256 & wait)


pv osm.20240325.versatiles | tee > (md5sum > osm.20240325.versatiles.md5) | sha256sum > osm.20240325.versatiles.sha256
