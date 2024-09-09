import { readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface FileGroup {
	title: string;
	order: number;
	local: boolean;
	latest?: File;
	files: File[];
}

export interface File {
	fullname: string;
	filename: string;
	size: number;
	ctime: Date;
}

export async function updateFiles(remotePath: string, localPath: string): Promise<FileGroup[]> {
	const files = await scanRemoteFiles(remotePath);
	const groups = generateFileGroups(files);

	return groups;
}

function generateFileGroups(files: File[]): FileGroup[] {
	const groupMap = new Map<string, FileGroup>();

	for (const file of files) {
		if (!file.filename.endsWith('.versatiles')) continue;
		const title = file.filename.split('.')[0];
		let order = 1000, local = false;
		switch (title) {
			case 'osm': order = 1; local = true; break;
			default:
				console.error('unknown file group: ' + title);
				continue;
		}
		if (!groupMap.has(title)) groupMap.set(title, { title, files: [], order, local })
		groupMap.get(title)?.files.push(file);
	}

	const groupList = Array.from(groupMap.values());

	groupList.sort((a, b) => a.order - b.order);

	groupList.forEach(group => {
		group.files.sort((a, b) => a.filename < b.filename ? -1 : 1);
		group.latest = {
			...group.files[group.files.length - 1],
		}
	})

	return groupList;
}

async function scanRemoteFiles(remotePath: string): Promise<File[]> {
	return Promise.all((await readdir(remotePath)).map(async filename => {
		const fullname = resolve(remotePath, filename);
		const { size, ctime } = await stat(fullname);
		return { fullname, filename, ctime, size }
	}))
}


/*
- **Cleanup**:
- Identify and delete any local files that are no longer needed to save disk space.
- **File Download**:
- Download only the latest file from the cloud storage to the local VM:
  ```javascript
  // Example Node.js code snippet
  const latestFile = getLatestFile(remoteFiles);
  downloadFile(latestFile, localDirectory);
  ```

  */