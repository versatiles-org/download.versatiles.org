import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FileRef } from '../file/file_ref.js';
import { groupFiles } from '../file/file_group.js';
import { planMirror, planStableCopies } from './plan.js';
import type { RemoteObject } from './rclone.js';

/** Every operation on R2, in the order it happened, e.g. `upload /osm.versatiles`. */
const log: string[] = [];

vi.mock('./rclone.js', () => ({
	uploadDataFile: vi.fn((file: FileRef) => log.push(`upload ${file.url}`)),
	copyDataFile: vi.fn((from: FileRef, to: FileRef) => log.push(`copy ${from.url} -> ${to.url}`)),
	uploadObject: vi.fn((url: string) => log.push(`put ${url}`)),
}));
vi.mock('../size_index/sync.js', () => ({
	ensureSizeIndex: vi.fn(async (file: FileRef) => log.push(`index ${file.url}`)),
	copySizeIndex: vi.fn((from: FileRef, to: FileRef) => log.push(`copy-index ${from.url} -> ${to.url}`)),
}));

const { executeMirror } = await import('./execute.js');
const { uploadDataFile, uploadObject } = await import('./rclone.js');
const { ensureSizeIndex } = await import('../size_index/sync.js');

const BASE = 'https://download.versatiles.org/';
const GB = 2 ** 30;

function file(name: string, size: number, content = name): FileRef {
	const ref = new FileRef(`/home/download/${name}`, size, `/home/download/${name}`);
	ref.hashes = { md5: `md5-${content}`, sha256: `sha-${content}` };
	return ref;
}

const uploaded = (f: FileRef): RemoteObject => ({ size: f.size, md5: f.md5, sha256: f.sha256 });

/** Plans and executes a run for the scanned `files` against the given bucket content. */
async function execute(files: FileRef[], remote: Record<string, RemoteObject> = {}, maxUploadBytes?: number) {
	const listing = new Map(Object.entries(remote));
	const plan = planMirror(files, listing, { maxUploadBytes });
	const groups = groupFiles(plan.published);
	await executeMirror(groups, plan, planStableCopies(groups, listing), BASE);
}

describe('executeMirror', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		log.length = 0;
	});

	it('rolls out a new release: own key, checksums, index, and only then the stable key', async () => {
		const previous = file('osm.20260413.versatiles', 60 * GB);
		const release = file('osm.20260608.versatiles', 62 * GB);

		await execute([previous, release], {
			'/osm.20260413.versatiles': uploaded(previous),
			'/osm.versatiles': uploaded(previous),
		});

		expect(log).toEqual([
			'upload /osm.20260608.versatiles',
			'put /osm.20260608.versatiles.md5',
			'put /osm.20260608.versatiles.sha256',
			'index /osm.20260608.versatiles',
			'copy /osm.20260608.versatiles -> /osm.versatiles',
			'put /osm.versatiles.md5',
			'put /osm.versatiles.sha256',
			'copy-index /osm.20260608.versatiles -> /osm.versatiles',
		]);
		expect(ensureSizeIndex).toHaveBeenCalledWith(release, BASE);
	});

	it('uploads the checksums of the stable key with the stable file name', async () => {
		const release = file('osm.20260608.versatiles', 62 * GB);

		await execute([release]);

		const stableMd5 = vi.mocked(uploadObject).mock.calls.find(([url]) => url === '/osm.versatiles.md5');
		expect(stableMd5?.[1]).toBe(`${release.md5} osm.versatiles\n`);
	});

	it('overwrites an undated dataset in place and follows up with checksums, then the index', async () => {
		const satellite = file('satellite.versatiles', 1700 * GB, 'new');

		await execute([satellite], { '/satellite.versatiles': { size: 1600 * GB, md5: 'md5-old', sha256: 'sha-old' } });

		expect(log).toEqual([
			'upload /satellite.versatiles',
			'put /satellite.versatiles.md5',
			'put /satellite.versatiles.sha256',
			'index /satellite.versatiles',
		]);
	});

	it('only checks the indices when the data is up to date', async () => {
		const release = file('osm.20260608.versatiles', 62 * GB);
		const satellite = file('satellite.versatiles', 1600 * GB);

		await execute([release, satellite], {
			'/osm.20260608.versatiles': uploaded(release),
			'/osm.versatiles': uploaded(release),
			'/satellite.versatiles': uploaded(satellite),
		});

		expect(log).toEqual([
			'index /osm.20260608.versatiles',
			'copy-index /osm.20260608.versatiles -> /osm.versatiles',
			'index /satellite.versatiles',
		]);
	});

	it('finishes one dataset before starting the next', async () => {
		const osm = file('osm.20260608.versatiles', 62 * GB);
		const landcover = file('landcover-vectors.20260608.versatiles', 2 * GB);

		await execute([landcover, osm]);

		const firstLandcover = log.findIndex((entry) => entry.includes('landcover'));
		const lastOsm = log.findLastIndex((entry) => entry.includes('/osm.'));
		expect(lastOsm).toBeLessThan(firstLandcover);
	});

	it('does not transfer a deferred file and leaves its stable key alone', async () => {
		const previous = file('osm.20260413.versatiles', 60 * GB);
		const release = file('osm.20260608.versatiles', 62 * GB);

		await execute(
			[previous, release],
			{ '/osm.20260413.versatiles': uploaded(previous), '/osm.versatiles': uploaded(previous) },
			61 * GB,
		);

		// The previous release stays the latest; only its indices are checked.
		expect(log).toEqual(['index /osm.20260413.versatiles', 'copy-index /osm.20260413.versatiles -> /osm.versatiles']);
		expect(uploadDataFile).not.toHaveBeenCalled();
	});

	it('stops at the first failure, before the stable key is touched', async () => {
		vi.mocked(ensureSizeIndex).mockRejectedValueOnce(new Error('index build failed'));

		await expect(execute([file('osm.20260608.versatiles', 62 * GB)])).rejects.toThrow('index build failed');

		expect(log).toEqual([
			'upload /osm.20260608.versatiles',
			'put /osm.20260608.versatiles.md5',
			'put /osm.20260608.versatiles.sha256',
		]);
	});
});
