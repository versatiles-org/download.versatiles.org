import { basename } from 'path';
import { FileRef } from './file_ref.js';
import { FileResponse } from './file_response.js';

export class FileGroup {
	slug: string;
	title: string;
	desc: string;
	order: number;
	local: boolean;
	latestFile?: FileRef;
	olderFiles: FileRef[];
	constructor(options: { slug: string, title: string, desc: string, order: number, local?: boolean, latestFile?: FileRef, olderFiles?: FileRef[] }) {
		this.slug = options.slug;
		this.title = options.title;
		this.desc = options.desc;
		this.order = options.order;
		this.local = options.local ?? false;
		this.latestFile = options.latestFile;
		this.olderFiles = options.olderFiles ?? [];
	}
	getResponseUrlList(baseURL: string): FileResponse {
		const file = this.latestFile;
		if (file == null) throw Error(`no latest file found in group "${this.slug}"`)
		const url = new URL(file.url, baseURL).href;

		return new FileResponse(
			`urllist_${this.slug}.tsv`,
			`TsvHttpData-1.0\n${url}\t${file.size}\t${hex2base64(file.md5)}\n`,
		);
	}
	getResponses(baseURL: string): FileResponse[] {
		const result: FileResponse[] = this.olderFiles.flatMap(f => [
			f.getResponseMd5File(),
			f.getResponseSha256File(),
		]);
		if (this.latestFile) {
			result.push(
				this.latestFile.getResponseMd5File(),
				this.latestFile.getResponseSha256File(),
				this.getResponseUrlList(baseURL),
			);
		}
		return result;
	}
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
				case 'landcover-vectors':
					title = 'Landcover as vector tiles';
					desc = [
						'Landcover vector tiles based on <a href="https://esa-worldcover.org/en/data-access">ESA Worldcover 2021</a>.',
						'Map Data © <a href="https://esa-worldcover.org/en/data-access">ESA WorldCover project 2021</a> / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium, available under <a href="http://creativecommons.org/licenses/by/4.0/"> CC-BY 4.0 International</a>'
					]
					order = 20;
					break;
				case 'bathymetry-vectors':
					title = 'Bathymetry as vector tiles';
					desc = [
						'Bathymetry Vectors, derived from the <a href="https://www.gebco.net/data_and_products/historical_data_sets/#gebco_2021">GEBCO 2021 Grid</a>, made with <a href="https://www.naturalearthdata.com/">NaturalEarth</a> by <a href="https://opendem.info">OpenDEM</a>',
					]
					order = 30;
					break;
				default:
					console.error(`Unknown group "${slug}"`);
			}

			group = new FileGroup({ slug, title, desc: desc.join('<br>'), order, local });
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

export function collectFiles(...entries: (FileGroup | FileGroup[] | FileRef | FileRef[])[]): FileRef[] {
	const files = new Map<string, FileRef>();
	for (const entry of entries) addEntry(entry);
	return Array.from(files.values());

	function addEntry(entry: FileGroup | FileGroup[] | FileRef | FileRef[]) {
		if (Array.isArray(entry)) {
			entry.forEach(addEntry);
		} else if (entry instanceof FileGroup) {
			addEntry(entry.olderFiles);
			if (entry.latestFile) addEntry(entry.latestFile);
		} else if (entry instanceof FileRef) {
			files.set(entry.url, entry);
		} else {
			throw Error();
		}
	}
}


export function hex2base64(hex: string): string {
	const base64 = Buffer.from(hex, 'hex').toString('base64url');
	return base64 + '='.repeat((4 - (base64.length % 4)) % 4);
}
