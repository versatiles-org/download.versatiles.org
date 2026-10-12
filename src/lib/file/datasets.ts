/**
 * The datasets published on download.versatiles.org.
 *
 * This table is the one place to edit when a dataset is added: a `.versatiles`
 * file on the Storage Box belongs to the dataset named by the part of its file
 * name before the first dot (`osm.20260105.versatiles` → `osm`), and only files
 * of a dataset listed here are published. Any other file stops the run — see
 * `assertKnownDatasets()` — so that a stray or misnamed file never reaches the
 * public page.
 */
import { basename } from 'path';

/** How a dataset is presented on the site. */
export interface Dataset {
	/** Human-readable title shown in the download listing. */
	title: string;
	/**
	 * Description paragraphs, including attribution and licence information.
	 * Kept as separate lines so each consumer can join them with its own
	 * separator; the lines may contain inline HTML such as links.
	 */
	desc: string[];
	/** Sort order in the listing; lower values appear first. */
	order: number;
	/** `'vector'` (the default) or `'raster'`. */
	tileType?: 'raster' | 'vector';
}

/** All published datasets, by slug. */
export const DATASETS: Readonly<Record<string, Dataset>> = {
	osm: {
		title: 'OpenStreetMap',
		desc: [
			'Full planet tileset with zoom levels 0-14 in <a href="https://shortbread-tiles.org/schema/">Shortbread Schema</a>.',
			'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap Contributors</a>, available under <a href="https://opendatacommons.org/licenses/odbl/">ODbL</a>',
		],
		order: 0,
	},
	'osm-landcover': {
		title: 'OpenStreetMap + Landcover (Beta)',
		desc: [
			'Combined tileset of <a href="https://www.openstreetmap.org/">OpenStreetMap</a> in <a href="https://shortbread-tiles.org/schema/">Shortbread Schema</a> and global landcover classification based on <a href="https://esa-worldcover.org/en/data-access">ESA WorldCover 2021</a>, merged into a single file.',
			'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap Contributors</a>, © <a href="https://esa-worldcover.org/en/data-access">ESA WorldCover project 2021</a>',
		],
		order: 5,
	},
	satellite: {
		title: 'Satellite Imagery (Alpha)',
		desc: ['Global satellite imagery composited from <a href="https://versatiles.org/sources/">open data sources</a>.'],
		order: 10,
		tileType: 'raster',
	},
	elevation: {
		title: 'Elevation Data (Beta)',
		desc: [
			'Global elevation data encoded as raster tiles.',
			'© <a href="https://mapterhorn.com/attribution">Mapterhorn</a>',
		],
		order: 20,
		tileType: 'raster',
	},
	'landcover-vectors': {
		title: 'Landcover (Beta)',
		desc: [
			'Global landcover classification based on <a href="https://esa-worldcover.org/en/data-access">ESA WorldCover 2021</a>.',
			'© <a href="https://esa-worldcover.org/en/data-access">ESA WorldCover project 2021</a> / Contains modified Copernicus Sentinel data (2021), available under <a href="http://creativecommons.org/licenses/by/4.0/">CC-BY 4.0</a>',
		],
		order: 30,
	},
	'hillshade-vectors': {
		title: 'Hillshading (Alpha)',
		desc: [
			'Hillshade contours based on <a href="https://github.com/tilezen/joerd">Mapzen Terrain Tiles</a>.',
			'© <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Mapzen Terrain Tiles, DEM Sources</a>',
		],
		order: 40,
	},
	'bathymetry-vectors': {
		title: 'Bathymetry (Alpha)',
		desc: [
			'Ocean depth contours derived from the <a href="https://www.gebco.net/data_and_products/historical_data_sets/#gebco_2021">GEBCO 2021 Grid</a>, processed with <a href="https://www.naturalearthdata.com/">Natural Earth</a> by <a href="https://opendem.info">OpenDEM</a>.',
		],
		order: 50,
	},
};

/** The slug of the dataset a file belongs to: its name up to the first dot. */
export function slugOf(filename: string): string {
	return basename(filename).replace(/\..*/, '');
}

/** The dataset with this slug, or undefined if it is not a published one. */
export function datasetOf(slug: string): Dataset | undefined {
	return Object.hasOwn(DATASETS, slug) ? DATASETS[slug] : undefined;
}

/** The file names among `filenames` that belong to no published dataset. */
export function unknownFiles(filenames: string[]): string[] {
	return filenames.filter((filename) => !datasetOf(slugOf(filename)));
}

/**
 * Throws, naming the files, if any of `filenames` belongs to no published
 * dataset.
 */
export function assertKnownDatasets(filenames: string[]): void {
	const unknown = unknownFiles(filenames);
	if (unknown.length === 0) return;

	const one = unknown.length === 1;
	throw new Error(
		[
			`Found ${one ? 'a file' : 'files'} on the Storage Box that belong${one ? 's' : ''} to no known dataset:`,
			...unknown.map((filename) => ` - ${filename}`),
			'Add the dataset to src/lib/file/datasets.ts, or move the file out of the scanned folder (STORAGE_ROOT).',
		].join('\n'),
	);
}
