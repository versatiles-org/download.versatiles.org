import { describe, it, expect } from 'vitest';
import { FileRef } from '../file/file_ref.js';
import { groupFiles } from '../file/file_group.js';
import type { RemoteObject } from './rclone.js';
import { DeferredUploadsError, deferredFiles, describePlan, planMirror, planStableCopies } from './plan.js';

const GB = 2 ** 30;

/** A scanned data file with hashes derived from `content`. */
function file(name: string, size: number, content = name): FileRef {
	const ref = new FileRef(`/home/data/${name}`, size, `/home/data/${name}`);
	ref.hashes = { md5: `md5-${content}`, sha256: `sha-${content}` };
	return ref;
}

/** An R2 object as it would have been uploaded for `content`. */
function object(size: number, content: string): RemoteObject {
	return { size, md5: `md5-${content}`, sha256: `sha-${content}` };
}

const remote = (entries: Record<string, RemoteObject>) => new Map(Object.entries(entries));

describe('planMirror', () => {
	it('skips a file whose md5 and size match the object on R2', () => {
		const osm = file('osm-vector.20260608.versatiles', 60 * GB);
		const plan = planMirror(
			[osm],
			remote({ '/osm-vector.20260608.versatiles': object(60 * GB, 'osm-vector.20260608.versatiles') }),
		);

		expect(plan.actions).toEqual([{ type: 'skip', file: osm }]);
		expect(plan.published).toEqual([osm]);
	});

	it('uploads a file that is not on R2', () => {
		const osm = file('osm-vector.20260608.versatiles', 60 * GB);
		const plan = planMirror([osm], remote({}));

		expect(plan.actions).toEqual([{ type: 'upload', file: osm }]);
		expect(plan.published).toEqual([osm]);
	});

	it('uploads a file whose md5 differs', () => {
		const osm = file('osm-vector.versatiles', 60 * GB, 'new');
		const plan = planMirror([osm], remote({ '/osm-vector.versatiles': object(60 * GB, 'old') }));

		expect(plan.actions).toEqual([{ type: 'upload', file: osm }]);
	});

	it('uploads again when the md5 matches but the size does not', () => {
		// The md5 is metadata written at the start of an upload; a size mismatch
		// means the object is not the file it claims to be.
		const osm = file('osm-vector.versatiles', 60 * GB);
		const plan = planMirror([osm], remote({ '/osm-vector.versatiles': object(59 * GB, 'osm-vector.versatiles') }));

		expect(plan.actions).toEqual([{ type: 'upload', file: osm }]);
	});

	it('uploads an object that has no checksum metadata', () => {
		const osm = file('osm-vector.versatiles', 60 * GB);
		const plan = planMirror([osm], remote({ '/osm-vector.versatiles': { size: 60 * GB, md5: null, sha256: null } }));

		expect(plan.actions).toEqual([{ type: 'upload', file: osm }]);
	});

	it('uploads everything without a limit, however large', () => {
		const satellite = file('satellite-raster.versatiles', 1600 * GB);

		expect(planMirror([satellite], remote({})).actions).toEqual([{ type: 'upload', file: satellite }]);
	});

	describe('with a size limit', () => {
		const options = { maxUploadBytes: 80 * GB };

		it('uploads a file of exactly the limit and defers one byte more', () => {
			const atLimit = file('a.versatiles', 80 * GB);
			const above = file('b.versatiles', 80 * GB + 1);

			const plan = planMirror([atLimit, above], remote({}), options);

			expect(plan.actions.map((action) => action.type)).toEqual(['upload', 'defer']);
		});

		it('never defers a file that is already current', () => {
			const satellite = file('satellite-raster.versatiles', 1600 * GB);
			const plan = planMirror(
				[satellite],
				remote({ '/satellite-raster.versatiles': object(1600 * GB, 'satellite-raster.versatiles') }),
				options,
			);

			expect(plan.actions).toEqual([{ type: 'skip', file: satellite }]);
			expect(deferredFiles(plan)).toEqual([]);
		});

		it('keeps publishing the version on R2 when a changed file is deferred', () => {
			const satellite = file('satellite-raster.versatiles', 1700 * GB, 'new');
			const plan = planMirror(
				[satellite],
				remote({ '/satellite-raster.versatiles': object(1600 * GB, 'old') }),
				options,
			);

			expect(deferredFiles(plan)).toEqual([satellite]);
			expect(plan.published).toHaveLength(1);
			// Described as R2 serves it — not as the Storage Box has it.
			const [current] = plan.published;
			expect(current).not.toBe(satellite);
			expect(current.url).toBe('/satellite-raster.versatiles');
			expect(current.size).toBe(1600 * GB);
			expect(current.md5).toBe('md5-old');
			expect(current.sha256).toBe('sha-old');
			expect(current.remotePath).toBe(satellite.remotePath);
		});

		it('publishes nothing for a deferred file that is not on R2 yet', () => {
			const elevation = file('elevation-raster.versatiles', 400 * GB);
			const plan = planMirror([elevation], remote({}), options);

			expect(plan.actions).toEqual([{ type: 'defer', file: elevation, published: null }]);
			expect(plan.published).toEqual([]);
		});

		it('publishes nothing for a deferred file whose R2 object has no checksums', () => {
			const elevation = file('elevation-raster.versatiles', 400 * GB);
			const plan = planMirror(
				[elevation],
				remote({ '/elevation-raster.versatiles': { size: 400 * GB, md5: null, sha256: null } }),
				options,
			);

			expect(plan.actions).toEqual([{ type: 'defer', file: elevation, published: null }]);
			expect(plan.published).toEqual([]);
		});

		it('handles each file on its own', () => {
			const osm = file('osm-vector.20260608.versatiles', 62 * GB);
			const satellite = file('satellite-raster.versatiles', 1700 * GB, 'new');
			const hillshade = file('hillshade-vector.versatiles', 105 * GB);

			const plan = planMirror(
				[osm, satellite, hillshade],
				remote({
					'/satellite-raster.versatiles': object(1600 * GB, 'old'),
					'/hillshade-vector.versatiles': object(105 * GB, 'hillshade-vector.versatiles'),
				}),
				options,
			);

			expect(plan.actions.map((action) => action.type)).toEqual(['upload', 'defer', 'skip']);
			expect(plan.published.map((f) => f.url)).toEqual([
				'/osm-vector.20260608.versatiles',
				'/satellite-raster.versatiles',
				'/hillshade-vector.versatiles',
			]);
		});

		it('leaves the previous release as the latest when a new dated release is deferred', () => {
			// Hypothetical limit below an OSM release, to exercise the dated case.
			const previous = file('osm-vector.20260413.versatiles', 60 * GB);
			const next = file('osm-vector.20260608.versatiles', 62 * GB);

			const plan = planMirror(
				[previous, next],
				remote({ '/osm-vector.20260413.versatiles': object(60 * GB, 'osm-vector.20260413.versatiles') }),
				{ maxUploadBytes: 61 * GB },
			);

			expect(deferredFiles(plan)).toEqual([next]);
			const [group] = groupFiles(plan.published);
			expect(group.latestFile?.url).toBe('/osm-vector.versatiles');
			expect(group.latestFile?.md5).toBe(previous.md5);
			expect(group.olderFiles.map((f) => f.url)).toEqual(['/osm-vector.20260413.versatiles']);
		});
	});
});

describe('planStableCopies', () => {
	const previous = file('osm-vector.20260413.versatiles', 60 * GB);
	const release = file('osm-vector.20260608.versatiles', 62 * GB);

	it('copies the latest release to the stable key when that key is outdated', () => {
		const groups = groupFiles([previous, release]);
		const copies = planStableCopies(
			groups,
			remote({ '/osm-vector.versatiles': object(60 * GB, 'osm-vector.20260413.versatiles') }),
		);

		expect(copies).toHaveLength(1);
		expect(copies[0].from).toBe(release);
		expect(copies[0].to.url).toBe('/osm-vector.versatiles');
		expect(copies[0].to.md5).toBe(release.md5);
	});

	it('copies when the stable key does not exist yet', () => {
		expect(planStableCopies(groupFiles([release]), remote({}))).toHaveLength(1);
	});

	it('copies nothing when the stable key already holds the latest release', () => {
		const copies = planStableCopies(
			groupFiles([previous, release]),
			remote({ '/osm-vector.versatiles': object(62 * GB, 'osm-vector.20260608.versatiles') }),
		);

		expect(copies).toEqual([]);
	});

	it('copies again when the stable key has the right md5 but the wrong size', () => {
		const copies = planStableCopies(
			groupFiles([release]),
			remote({ '/osm-vector.versatiles': object(61 * GB, 'osm-vector.20260608.versatiles') }),
		);

		expect(copies).toHaveLength(1);
	});

	it('needs no copy for a dataset that only has an undated file', () => {
		const satellite = file('satellite-raster.versatiles', 1600 * GB);

		expect(planStableCopies(groupFiles([satellite]), remote({}))).toEqual([]);
	});
});

describe('describePlan', () => {
	it('lists what will change and counts what will not', () => {
		const release = file('osm-vector.20260608.versatiles', 62 * GB);
		const satellite = file('satellite-raster.versatiles', 1700 * GB, 'new');
		const elevation = file('elevation-raster.versatiles', 400 * GB);
		const hillshade = file('hillshade-vector.versatiles', 105 * GB);

		const plan = planMirror(
			[release, satellite, elevation, hillshade],
			remote({
				'/satellite-raster.versatiles': object(1600 * GB, 'old'),
				'/hillshade-vector.versatiles': object(105 * GB, 'hillshade-vector.versatiles'),
			}),
			{ maxUploadBytes: 80 * GB },
		);
		const copies = planStableCopies(groupFiles(plan.published), remote({}));

		expect(describePlan(plan, copies).split('\n')).toEqual([
			' - upload osm-vector.20260608.versatiles (62.0 GB)',
			' - defer  satellite-raster.versatiles (1.66 TB) — too large; the version on R2 stays published',
			' - defer  elevation-raster.versatiles (400.0 GB) — too large; not on R2 yet, so not published',
			' - copy   osm-vector.20260608.versatiles -> osm-vector.versatiles within R2',
			' - 1 data file unchanged',
		]);
	});
});

describe('DeferredUploadsError', () => {
	it('names the single skipped upload and the limit', () => {
		const error = new DeferredUploadsError([file('satellite-raster.versatiles', 1700 * GB)], 80 * GB);

		expect(error.message).toContain('1 upload greater than 80 GB was skipped:');
		expect(error.message).toContain(' - satellite-raster.versatiles (1.66 TB)');
		expect(error.message).toContain('have to be handled on a real server');
	});

	it('shows a fractional limit', () => {
		const error = new DeferredUploadsError([file('a.versatiles', 2 * GB)], 1.5 * GB);

		expect(error.message).toContain('greater than 1.5 GB');
	});
});
