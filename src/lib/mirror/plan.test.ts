import { describe, it, expect } from 'vitest';
import { FileRef } from '../file/file_ref.js';
import { groupFiles } from '../file/file_group.js';
import type { RemoteObject } from './rclone.js';
import { deferredFiles, planMirror } from './plan.js';

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
		const osm = file('osm.20260608.versatiles', 60 * GB);
		const plan = planMirror([osm], remote({ '/osm.20260608.versatiles': object(60 * GB, 'osm.20260608.versatiles') }));

		expect(plan.actions).toEqual([{ type: 'skip', file: osm }]);
		expect(plan.published).toEqual([osm]);
	});

	it('uploads a file that is not on R2', () => {
		const osm = file('osm.20260608.versatiles', 60 * GB);
		const plan = planMirror([osm], remote({}));

		expect(plan.actions).toEqual([{ type: 'upload', file: osm }]);
		expect(plan.published).toEqual([osm]);
	});

	it('uploads a file whose md5 differs', () => {
		const osm = file('osm.versatiles', 60 * GB, 'new');
		const plan = planMirror([osm], remote({ '/osm.versatiles': object(60 * GB, 'old') }));

		expect(plan.actions).toEqual([{ type: 'upload', file: osm }]);
	});

	it('uploads again when the md5 matches but the size does not', () => {
		// The md5 is metadata written at the start of an upload; a size mismatch
		// means the object is not the file it claims to be.
		const osm = file('osm.versatiles', 60 * GB);
		const plan = planMirror([osm], remote({ '/osm.versatiles': object(59 * GB, 'osm.versatiles') }));

		expect(plan.actions).toEqual([{ type: 'upload', file: osm }]);
	});

	it('uploads an object that has no checksum metadata', () => {
		const osm = file('osm.versatiles', 60 * GB);
		const plan = planMirror([osm], remote({ '/osm.versatiles': { size: 60 * GB, md5: null, sha256: null } }));

		expect(plan.actions).toEqual([{ type: 'upload', file: osm }]);
	});

	it('uploads everything without a limit, however large', () => {
		const satellite = file('satellite.versatiles', 1600 * GB);

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
			const satellite = file('satellite.versatiles', 1600 * GB);
			const plan = planMirror(
				[satellite],
				remote({ '/satellite.versatiles': object(1600 * GB, 'satellite.versatiles') }),
				options,
			);

			expect(plan.actions).toEqual([{ type: 'skip', file: satellite }]);
			expect(deferredFiles(plan)).toEqual([]);
		});

		it('keeps publishing the version on R2 when a changed file is deferred', () => {
			const satellite = file('satellite.versatiles', 1700 * GB, 'new');
			const plan = planMirror([satellite], remote({ '/satellite.versatiles': object(1600 * GB, 'old') }), options);

			expect(deferredFiles(plan)).toEqual([satellite]);
			expect(plan.published).toHaveLength(1);
			// Described as R2 serves it — not as the Storage Box has it.
			const [current] = plan.published;
			expect(current).not.toBe(satellite);
			expect(current.url).toBe('/satellite.versatiles');
			expect(current.size).toBe(1600 * GB);
			expect(current.md5).toBe('md5-old');
			expect(current.sha256).toBe('sha-old');
			expect(current.remotePath).toBe(satellite.remotePath);
		});

		it('publishes nothing for a deferred file that is not on R2 yet', () => {
			const elevation = file('elevation.versatiles', 400 * GB);
			const plan = planMirror([elevation], remote({}), options);

			expect(plan.actions).toEqual([{ type: 'defer', file: elevation, published: null }]);
			expect(plan.published).toEqual([]);
		});

		it('publishes nothing for a deferred file whose R2 object has no checksums', () => {
			const elevation = file('elevation.versatiles', 400 * GB);
			const plan = planMirror(
				[elevation],
				remote({ '/elevation.versatiles': { size: 400 * GB, md5: null, sha256: null } }),
				options,
			);

			expect(plan.actions).toEqual([{ type: 'defer', file: elevation, published: null }]);
			expect(plan.published).toEqual([]);
		});

		it('handles each file on its own', () => {
			const osm = file('osm.20260608.versatiles', 62 * GB);
			const satellite = file('satellite.versatiles', 1700 * GB, 'new');
			const hillshade = file('hillshade-vectors.versatiles', 105 * GB);

			const plan = planMirror(
				[osm, satellite, hillshade],
				remote({
					'/satellite.versatiles': object(1600 * GB, 'old'),
					'/hillshade-vectors.versatiles': object(105 * GB, 'hillshade-vectors.versatiles'),
				}),
				options,
			);

			expect(plan.actions.map((action) => action.type)).toEqual(['upload', 'defer', 'skip']);
			expect(plan.published.map((f) => f.url)).toEqual([
				'/osm.20260608.versatiles',
				'/satellite.versatiles',
				'/hillshade-vectors.versatiles',
			]);
		});

		it('leaves the previous release as the latest when a new dated release is deferred', () => {
			// Hypothetical limit below an OSM release, to exercise the dated case.
			const previous = file('osm.20260413.versatiles', 60 * GB);
			const next = file('osm.20260608.versatiles', 62 * GB);

			const plan = planMirror(
				[previous, next],
				remote({ '/osm.20260413.versatiles': object(60 * GB, 'osm.20260413.versatiles') }),
				{ maxUploadBytes: 61 * GB },
			);

			expect(deferredFiles(plan)).toEqual([next]);
			const [group] = groupFiles(plan.published);
			expect(group.latestFile?.url).toBe('/osm.versatiles');
			expect(group.latestFile?.md5).toBe(previous.md5);
			expect(group.olderFiles.map((f) => f.url)).toEqual(['/osm.20260413.versatiles']);
		});
	});
});
