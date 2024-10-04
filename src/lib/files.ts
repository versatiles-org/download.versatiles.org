import { readdir, stat, cp, rm } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

export interface FileGroup {
	slug: string;
	title: string;
	desc: string;
	order: number;
	local: boolean;
	latestFile?: File;
	olderFiles: File[];
}

export interface File {
	fullname: string;
	filename: string;
	url: string;
	size: number;
	sizeString: string;
	md5?: string;
	sha?: string;
}

export async function getAllFiles(folder: string): Promise<File[]> {
	const files: File[] = [];
	try {
		const filenames = await readdir(folder);
		for (const filename of filenames) {
			if (!filename.endsWith('.versatiles')) continue;
			const fullname = resolve(folder, filename);
			const { size } = await stat(fullname);
			const sizeString = (size / (2 ** 30)).toFixed(1) + ' GB';
			files.push({ fullname, filename, size, url: filename, sizeString });
		}
	} catch (error) {
		console.error(`Failed to read files in folder "${folder}": ${error}`);
	}
	return files;
}

export function groupFiles(files: File[]): FileGroup[] {
	const groupMap = new Map<string, FileGroup>();
	files.forEach(file => {
		const slug = basename(file.filename).replace(/\..*/, '');
		let group = groupMap.get(slug);

		if (!group) {
			let title = '???', desc: string[] = [], order = 10000, local = false;
			switch (slug) {
				case 'osm':
					title = 'OpenStreetMap as vector tiles';
					desc = [
						'The full <a href="https://www.openstreetmap.org/">OpenStreetMap</a> planet as vector tilesets with zoom levels 0-14 in <a href="https://shortbread-tiles.org/schema/">Shortbread Schema</a>.',
						'Map Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap Contributors</a> available under <a href="https://opendatacommons.org/licenses/odbl/">ODbL</a>'
					];
					order = 0;
					local = true;
					break;
				case 'hillshade-vectors':
					title = 'Hillshading as vector tiles';
					desc = [
						'Hillshade vector tiles based on <a href="https://github.com/tilezen/joerd">Mapzen Jörð Terrain Tiles</a>.',
						'Map Data © <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Mapzen Terrain Tiles, DEM Sources</a>'
					]
					order = 10;
					break;
				default:
					console.error(`Unknown group "${slug}"`);
			}

			group = { slug, title, desc: desc.join('<br>'), order, local, olderFiles: [] };
			groupMap.set(slug, group);
		}

		group.olderFiles.push(file);
	});

	const groupList = Array.from(groupMap.values());

	groupList.sort((a, b) => a.order - b.order);

	groupList.forEach(group => {
		group.olderFiles.sort((a, b) => a.filename < b.filename ? 1 : -1);
		group.latestFile = { ...group.olderFiles[0] };
		const newUrl = group.latestFile.url.replace(/\.\d{8}\./, '.');
		if (newUrl === group.latestFile.url) {
			group.olderFiles.shift();
		} else {
			group.latestFile.url = newUrl;
		}
	});

	return groupList;
}

export async function syncFiles(remoteFiles: File[], localFiles: File[], localFolder: string): Promise<void> {
	console.log('syncing files');

	const deleteFiles = new Map(localFiles.map(f => [f.filename, f]));
	const copyFiles = new Map(remoteFiles.map(f => [f.filename, f]));

	for (const remoteFile of remoteFiles) {
		const { filename } = remoteFile;
		const localFile = deleteFiles.get(filename);
		if (localFile && localFile.size === remoteFile.size) {
			copyFiles.delete(filename);
			deleteFiles.delete(filename);
		}
	}

	try {
		for (const file of deleteFiles.values()) {
			console.log(`Deleting "${file.filename}"`);
			await rm(file.fullname);
		}

		for (const file of copyFiles.values()) {
			const fullname = resolve(localFolder, file.filename);
			console.log(`Copying "${file.filename}"`);
			await cp(file.fullname, fullname);
			file.fullname = fullname; // Update the file's fullname to reflect its new location
		}
	} catch (error) {
		console.error(`Failed to sync files: ${error}`);
	}
}

export async function downloadLocalFiles(fileGroups: FileGroup[], localFolder: string) {
	const localFiles = fileGroups.flatMap(group =>
		(group.local && group.latestFile) ? [group.latestFile] : []
	);
	await syncFiles(localFiles, await getAllFiles(localFolder), localFolder);
}
