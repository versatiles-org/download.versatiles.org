import { basename } from 'node:path';
import { FileRef, getAllFilesRecursive, syncFiles } from './file_ref.js';

export interface FileGroup {
	slug: string;
	title: string;
	desc: string;
	order: number;
	local: boolean;
	latestFile?: FileRef;
	olderFiles: FileRef[];
}

export function isFileGroup(entry: object): entry is FileGroup {
	return (
		('slug' in entry && typeof entry.slug == 'string') &&
		('title' in entry && typeof entry.title == 'string') &&
		('desc' in entry && typeof entry.desc == 'string') &&
		('order' in entry && typeof entry.order == 'number') &&
		('local' in entry && typeof entry.local == 'boolean'));
}

export function groupFiles(files: FileRef[]): FileGroup[] {
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
		group.latestFile = group.olderFiles[0].clone();
		const newUrl = group.latestFile.url.replace(/\.\d{8}\./, '.');
		if (newUrl === group.latestFile.url) {
			group.olderFiles.shift();
		} else {
			group.latestFile.url = newUrl;
		}
	});

	return groupList;
}

export async function downloadLocalFiles(fileGroups: FileGroup[], localFolder: string) {
	const localFiles = fileGroups.flatMap(group =>
		(group.local && group.latestFile) ? [group.latestFile] : []
	);
	await syncFiles(localFiles, await getAllFilesRecursive(localFolder), localFolder);
}

export function collectFiles(...entries: (FileGroup | FileGroup[] | FileRef | FileRef[])[]): FileRef[] {
	const files = new Map<string, FileRef>();
	for (const entry of entries) addEntry(entry);
	return Array.from(files.values());

	function addEntry(entry: FileGroup | FileGroup[] | FileRef | FileRef[]) {
		if (Array.isArray(entry)) {
			entry.forEach(addEntry);
		} else if (isFileGroup(entry)) {
			addEntry(entry.olderFiles);
			if (entry.latestFile) addEntry(entry.latestFile);
		} else if (entry instanceof FileRef) {
			files.set(entry.url, entry);
		} else {
			throw Error();
		}
	}
}
