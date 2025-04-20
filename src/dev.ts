import express from 'express';
import { resolve } from 'path';
import { FileGroup } from './lib/file/file_group.js';
import { FileRef } from './lib/file/file_ref.js';
import { buildHTML } from './lib/html/html.js';



export const app = express();
const fileGroups = getDummyData();

app.get('/', async (_, res) => {
	const html = buildHTML(fileGroups);
	res.status(200).type('html').end(html);
})

if (process.env['NODE_ENV'] !== 'test') {
	app.listen(8080,
		() => console.log('listening on http://localhost:8080/')
	);
}


function getDummyData(): FileGroup[] {
	return [
		new FileGroup({
			slug: 'osm',
			title: 'OpenStreetMap as vector tiles',
			order: 0,
			local: true,
			desc: 'The full <a href="https://www.openstreetmap.org/">OpenStreetMap</a> planet as vector tilesets with zoom levels 0-14 in <a href="https://shortbread-tiles.org/schema/">Shortbread Schema</a>.<br>Map Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap Contributors</a> available under <a href="https://opendatacommons.org/licenses/odbl/">ODbL</a>',
			latestFile: getFile('osm/osm.20240701.versatiles', 58826947443),
			olderFiles: [
				getFile('osm/osm.20240701.versatiles', 58826947443),
				getFile('osm/osm.20240325.versatiles', 57670238925),
				getFile('osm/osm.20240101.versatiles', 55594444850),
				getFile('osm/osm.20230925.versatiles', 54511085405),
				getFile('osm/osm.20230605.versatiles', 57615485619),
				getFile('osm/osm.20230529.versatiles', 55124552729),
				getFile('osm/osm.20230227.versatiles', 54217850756),
				getFile('osm/osm.20230101.versatiles', 48112391349),
			],
		}),
		new FileGroup({
			slug: 'hillshade-vectors',
			title: 'Hillshading as vector tiles',
			order: 10,
			local: false,
			desc: 'Hillshade vector tiles based on <a href="https://github.com/tilezen/joerd">Mapzen Jörð Terrain Tiles</a>.<br>Map Data © <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Mapzen Terrain Tiles, DEM Sources</a>',
			latestFile: getFile('hillshade-vectors/hillshade-vectors.versatiles', 113202788651),
		}),
		new FileGroup({
			slug: 'landcover-vectors',
			title: 'Landcover as vector tiles',
			order: 20,
			local: false,
			desc: 'Landcover vector tiles based on <a href="https://esa-worldcover.org/en/data-access">ESA Worldcover 2021</a>.<br>Map Data © <a href="https://esa-worldcover.org/en/data-access">ESA WorldCover project 2021</a> / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium, available under <a href="http://creativecommons.org/licenses/by/4.0/"> CC-BY 4.0 International</a>',
			latestFile: getFile('landcover-vectors/landcover-vectors.versatiles', 826877129),
		}),
		new FileGroup({
			slug: 'bathymetry-vectors',
			title: 'Bathymetry as vector tiles',
			order: 30,
			local: false,
			desc: 'Bathymetry Vectors, derived from the <a href="https://www.gebco.net/data_and_products/historical_data_sets/#gebco_2021">GEBCO 2021 Grid</a>, made with <a href="https://www.naturalearthdata.com/">NaturalEarth</a> by <a href="https://opendem.info">OpenDEM</a>',
			latestFile: getFile('bathymetry-vectors/bathymetry-vectors.versatiles', 713796682),
		}),
	];

	function getFile(fullname: string, size: number): FileRef {
		const f = new FileRef(resolve('/volumes/remote_files/', fullname), size);
		f.hashes = {
			md5: '3a55c7e14903703e6aca2eed2d5c5091',
			sha256: 'e676999d87d479da5a36d1170189e93ef0d445a4cbad69c7469290d0a8237d5'
		}
		return f;
	}
}