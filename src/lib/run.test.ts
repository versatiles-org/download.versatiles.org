import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileRef } from './file/file_ref.js';
import { DeferredUploadsError } from './mirror/plan.js';
import type { RemoteObject } from './mirror/rclone.js';

console.log = vi.fn();

vi.mock('./preflight.js', () => ({ preflight: vi.fn() }));
vi.mock('./lock.js', () => ({ acquireLock: vi.fn() }));
vi.mock('./size_index/sync.js', () => ({ isCurrent: vi.fn() }));
vi.mock('./source/scan.js', () => ({ getRemoteFiles: vi.fn() }));
vi.mock('./file/hashes.js', () => ({ generateHashes: vi.fn() }));
vi.mock('./mirror/rclone.js', () => ({ listRemoteDataFiles: vi.fn() }));
vi.mock('./mirror/execute.js', () => ({ executeMirror: vi.fn() }));
vi.mock('./site/site.js', () => ({ buildAndUploadSite: vi.fn() }));

// Planning and grouping are not mocked: what the run publishes is the point.
const { run } = await import('./run.js');
const { preflight } = await import('./preflight.js');
const { acquireLock } = await import('./lock.js');
const { isCurrent } = await import('./size_index/sync.js');
const { getRemoteFiles } = await import('./source/scan.js');
const { generateHashes } = await import('./file/hashes.js');
const { listRemoteDataFiles } = await import('./mirror/rclone.js');
const { executeMirror } = await import('./mirror/execute.js');
const { buildAndUploadSite } = await import('./site/site.js');

const GB = 2 ** 30;

function file(name: string, size: number, content = name): FileRef {
	const ref = new FileRef(`/home/download/${name}`, size, `/home/download/${name}`);
	ref.hashes = { md5: `md5-${content}`, sha256: `sha-${content}` };
	return ref;
}

/** The R2 object a file leaves behind once it has been uploaded. */
const uploaded = (f: FileRef): RemoteObject => ({ size: f.size, md5: f.md5, sha256: f.sha256 });

/** Sets up what the scan finds and what is on R2. */
function given(files: FileRef[], remote: Record<string, RemoteObject> = {}): void {
	vi.mocked(getRemoteFiles).mockReturnValue(files.map((f) => ({ file: f, mtime: null, sidecars: {} })));
	vi.mocked(listRemoteDataFiles).mockReturnValue(new Map(Object.entries(remote)));
}

/** The file groups the site was built from. */
const publishedGroups = () => vi.mocked(buildAndUploadSite).mock.calls[0][0];

/** The urls of the uploads and copies the mirror was asked to execute. */
function executed(): { uploads: string[]; copies: string[] } {
	const [, plan, copies] = vi.mocked(executeMirror).mock.calls[0];
	return {
		uploads: plan.actions.filter((action) => action.type === 'upload').map((action) => action.file.url),
		copies: copies.map((copy) => `${copy.from.url} -> ${copy.to.url}`),
	};
}

describe('run', () => {
	const release = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(acquireLock).mockReturnValue(release);
		vi.mocked(generateHashes).mockResolvedValue([]);
		vi.mocked(isCurrent).mockReturnValue(true);

		vi.stubEnv('DRY_RUN', undefined);
		vi.stubEnv('DOMAIN', 'example.com');
		vi.stubEnv('STORAGE_URL', 'user@host');
		vi.stubEnv('RCLONE_SFTP_REMOTE', 'hetzner');
		vi.stubEnv('RCLONE_R2_REMOTE', 'r2');
		vi.stubEnv('R2_BUCKET', 'downloads');
		vi.stubEnv('MAX_UPLOAD_GB', undefined);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('should throw before doing anything if the configuration is incomplete', async () => {
		vi.stubEnv('DOMAIN', undefined);
		vi.stubEnv('R2_BUCKET', undefined);

		await expect(run()).rejects.toThrow(/DOMAIN is not set[\s\S]*R2_BUCKET is not set/);
		expect(getRemoteFiles).not.toHaveBeenCalled();
	});

	it('should stop before scanning if the preflight fails', async () => {
		vi.mocked(preflight).mockRejectedValueOnce(new Error('Preflight failed'));

		await expect(run()).rejects.toThrow('Preflight failed');
		expect(getRemoteFiles).not.toHaveBeenCalled();
	});

	it('should throw an error if no files are found in the remote folder', async () => {
		given([]);

		await expect(run()).rejects.toThrow('no remote files found');
	});

	it('stops before hashing when a file belongs to no known dataset', async () => {
		given([file('osm.20260608.versatiles', 62 * GB), file('test.versatiles', GB)]);

		await expect(run()).rejects.toThrow(/belongs to no known dataset:\n - test\.versatiles\n/);
		expect(generateHashes).not.toHaveBeenCalled();
		expect(buildAndUploadSite).not.toHaveBeenCalled();
	});

	it('mirrors a new release with a copy to its stable key, then publishes the site', async () => {
		const previous = file('osm.20260413.versatiles', 60 * GB);
		const release = file('osm.20260608.versatiles', 62 * GB);
		given([previous, release], {
			'/osm.20260413.versatiles': uploaded(previous),
			'/osm.versatiles': uploaded(previous),
		});

		await run();

		expect(generateHashes).toHaveBeenCalled();
		// Only the new release crosses the network; its stable key is made inside R2.
		expect(executed()).toEqual({
			uploads: ['/osm.20260608.versatiles'],
			copies: ['/osm.20260608.versatiles -> /osm.versatiles'],
		});

		const groups = publishedGroups();
		expect(groups).toHaveLength(1);
		expect(groups[0].latestFile?.md5).toBe(release.md5);
		// The mirror and the site work from the same groups and base URL.
		expect(vi.mocked(executeMirror).mock.calls[0][0]).toBe(groups);
		expect(vi.mocked(executeMirror).mock.calls[0][3]).toBe('https://example.com/');
		expect(buildAndUploadSite).toHaveBeenCalledWith(groups, 'https://example.com/');
	});

	it('plans no transfer when R2 is up to date', async () => {
		const release = file('osm.20260608.versatiles', 62 * GB);
		const satellite = file('satellite.versatiles', 1600 * GB);
		given([release, satellite], {
			'/osm.20260608.versatiles': uploaded(release),
			'/osm.versatiles': uploaded(release),
			'/satellite.versatiles': uploaded(satellite),
		});

		await run();

		expect(executed()).toEqual({ uploads: [], copies: [] });
		expect(buildAndUploadSite).toHaveBeenCalled();
	});

	it('should mirror the data before uploading the site (atomic publish)', async () => {
		given([file('osm.20260608.versatiles', 62 * GB)]);

		await run();

		expect(vi.mocked(executeMirror).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(buildAndUploadSite).mock.invocationCallOrder[0],
		);
	});

	it('stops before publishing the site when the mirror fails', async () => {
		given([file('osm.20260608.versatiles', 62 * GB)]);
		vi.mocked(executeMirror).mockRejectedValueOnce(new Error('rclone failed'));

		await expect(run()).rejects.toThrow('rclone failed');
		expect(buildAndUploadSite).not.toHaveBeenCalled();
	});

	it('uploads files of any size when there is no limit', async () => {
		given([file('satellite.versatiles', 1600 * GB)]);

		await run();

		expect(executed().uploads).toEqual(['/satellite.versatiles']);
	});

	describe('lock', () => {
		it('holds the lock from before the scan until the site is published', async () => {
			given([file('osm.20260608.versatiles', 62 * GB)]);

			await run();

			const at = (mock: unknown) => vi.mocked(mock as () => void).mock.invocationCallOrder[0];
			expect(at(acquireLock)).toBeLessThan(at(getRemoteFiles));
			expect(at(buildAndUploadSite)).toBeLessThan(at(release));
		});

		it('does nothing while another run holds the lock', async () => {
			vi.mocked(acquireLock).mockImplementation(() => {
				throw new Error('Another update is already running');
			});

			await expect(run()).rejects.toThrow('Another update is already running');
			expect(preflight).not.toHaveBeenCalled();
			expect(release).not.toHaveBeenCalled();
		});

		it('releases the lock when the run fails', async () => {
			given([file('osm.20260608.versatiles', 62 * GB)]);
			vi.mocked(executeMirror).mockRejectedValueOnce(new Error('rclone failed'));

			await expect(run()).rejects.toThrow('rclone failed');
			expect(release).toHaveBeenCalled();
		});
	});

	describe('dry run', () => {
		const output = () =>
			vi
				.mocked(console.log)
				.mock.calls.map((call) => String(call[0]))
				.join('\n');

		it('prints the plan and changes nothing', async () => {
			const previous = file('osm.20260413.versatiles', 60 * GB);
			const release = file('osm.20260608.versatiles', 62 * GB);
			given([previous, release], {
				'/osm.20260413.versatiles': uploaded(previous),
				'/osm.versatiles': uploaded(previous),
			});

			await run({ dryRun: true });

			expect(generateHashes).toHaveBeenCalledWith(expect.anything(), { compute: false });
			expect(executeMirror).not.toHaveBeenCalled();
			expect(buildAndUploadSite).not.toHaveBeenCalled();
			expect(acquireLock).not.toHaveBeenCalled();
			expect(output()).toContain(
				[
					'Dry run — this is what an update would do:',
					' - upload osm.20260608.versatiles (62.0 GB)',
					' - index  osm.20260608.versatiles — build the size index',
					' - copy   osm.20260608.versatiles -> osm.versatiles within R2',
					' - 1 data file unchanged',
					' - build and upload the site',
					'Nothing was changed.',
				].join('\n'),
			);
		});

		it('is switched on by DRY_RUN', async () => {
			vi.stubEnv('DRY_RUN', '1');
			given([file('osm.20260608.versatiles', 62 * GB)]);

			await run();

			expect(executeMirror).not.toHaveBeenCalled();
		});

		it('reports an outdated size index of data that is otherwise up to date', async () => {
			const satellite = file('satellite.versatiles', 1600 * GB);
			given([satellite], { '/satellite.versatiles': uploaded(satellite) });
			vi.mocked(isCurrent).mockReturnValue(false);

			await run({ dryRun: true });

			expect(output()).toContain(' - index  satellite.versatiles — build the size index');
		});

		it('names files whose checksums would have to be computed first', async () => {
			const release = file('osm.20260608.versatiles', 62 * GB);
			const unhashed = new FileRef(
				'/home/download/elevation.versatiles',
				400 * GB,
				'/home/download/elevation.versatiles',
			);
			given([release, unhashed]);
			vi.mocked(generateHashes).mockResolvedValue([unhashed]);

			await run({ dryRun: true });

			expect(output()).toContain(' - upload osm.20260608.versatiles');
			expect(output()).toContain(' - hash   elevation.versatiles (400.0 GB) — compute its checksums first');
			// It took no part in the plan.
			expect(output()).not.toContain('upload elevation.versatiles');
		});

		it('reports deferred uploads without failing', async () => {
			vi.stubEnv('MAX_UPLOAD_GB', '80');
			given([file('elevation.versatiles', 400 * GB)]);

			await expect(run({ dryRun: true })).resolves.toBeUndefined();
			expect(output()).toContain(' - defer  elevation.versatiles (400.0 GB)');
		});
	});

	describe('with MAX_UPLOAD_GB', () => {
		beforeEach(() => vi.stubEnv('MAX_UPLOAD_GB', '80'));

		it('does everything else, then fails naming the skipped uploads', async () => {
			const release = file('osm.20260608.versatiles', 62 * GB);
			const satellite = file('satellite.versatiles', 1700 * GB, 'new');
			const elevation = file('elevation.versatiles', 400 * GB);
			given([release, satellite, elevation], {
				'/satellite.versatiles': { size: 1600 * GB, md5: 'md5-old', sha256: 'sha-old' },
			});

			const error = await run().catch((e: unknown) => e);

			expect(error).toBeInstanceOf(DeferredUploadsError);
			expect((error as DeferredUploadsError).files).toEqual([satellite, elevation]);
			expect((error as Error).message).toBe(
				[
					'Update complete, but 2 uploads greater than 80 GB were skipped:',
					' - satellite.versatiles (1.66 TB)',
					' - elevation.versatiles (400.0 GB)',
					'Uploads greater than 80 GB have to be handled on a real server: run `npm run once` there, without MAX_UPLOAD_GB.',
				].join('\n'),
			);

			// The small upload was executed, and the site was published before failing.
			expect(executed()).toEqual({
				uploads: [release.url],
				copies: ['/osm.20260608.versatiles -> /osm.versatiles'],
			});
			expect(buildAndUploadSite).toHaveBeenCalled();
		});

		it('publishes what R2 serves for a deferred file, and nothing for one that is not there', async () => {
			const satellite = file('satellite.versatiles', 1700 * GB, 'new');
			const elevation = file('elevation.versatiles', 400 * GB);
			given([satellite, elevation], {
				'/satellite.versatiles': { size: 1600 * GB, md5: 'md5-old', sha256: 'sha-old' },
			});

			await run().catch(() => {});

			const groups = publishedGroups();
			expect(groups.map((group) => group.slug)).toEqual(['satellite']);
			expect(groups[0].latestFile?.size).toBe(1600 * GB);
			expect(groups[0].latestFile?.md5).toBe('md5-old');
			expect(executed().uploads).toEqual([]);
		});

		it('fails without publishing an empty site when nothing can be published', async () => {
			given([file('elevation.versatiles', 400 * GB)]);

			await expect(run()).rejects.toThrow('none of the remote files can be published');
			expect(buildAndUploadSite).not.toHaveBeenCalled();
		});

		it('succeeds when nothing exceeds the limit', async () => {
			given([file('osm.20260608.versatiles', 62 * GB)]);

			await expect(run()).resolves.toBeUndefined();
		});
	});
});
