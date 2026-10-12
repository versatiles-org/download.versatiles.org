import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileRef } from './file/file_ref.js';
import { DeferredUploadsError } from './mirror/plan.js';
import type { RemoteObject } from './mirror/rclone.js';

console.log = vi.fn();

vi.mock('./preflight.js', () => ({ preflight: vi.fn() }));
vi.mock('./source/scan.js', () => ({ getRemoteFiles: vi.fn() }));
vi.mock('./file/hashes.js', () => ({ generateHashes: vi.fn() }));
vi.mock('./mirror/rclone.js', () => ({
	listRemoteDataFiles: vi.fn(),
	uploadDataFile: vi.fn(),
	copyDataFile: vi.fn(),
}));
vi.mock('./size_index/sync.js', () => ({ syncSizeIndices: vi.fn() }));
vi.mock('./site/site.js', () => ({ buildAndUploadSite: vi.fn() }));

// Planning and grouping are not mocked: what the run publishes is the point.
const { run } = await import('./run.js');
const { preflight } = await import('./preflight.js');
const { getRemoteFiles } = await import('./source/scan.js');
const { generateHashes } = await import('./file/hashes.js');
const { listRemoteDataFiles, uploadDataFile, copyDataFile } = await import('./mirror/rclone.js');
const { syncSizeIndices } = await import('./size_index/sync.js');
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

const order = (mock: unknown) => vi.mocked(mock as () => void).mock.invocationCallOrder[0];

describe('run', () => {
	beforeEach(() => {
		vi.clearAllMocks();

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

	it('uploads a new release, copies it to the stable key and publishes the site', async () => {
		const previous = file('osm.20260413.versatiles', 60 * GB);
		const release = file('osm.20260608.versatiles', 62 * GB);
		given([previous, release], {
			'/osm.20260413.versatiles': uploaded(previous),
			'/osm.versatiles': uploaded(previous),
		});

		await run();

		expect(generateHashes).toHaveBeenCalled();
		// Only the new release crosses the network…
		expect(vi.mocked(uploadDataFile).mock.calls).toEqual([[release]]);
		// …and its stable key is made from it inside R2.
		expect(copyDataFile).toHaveBeenCalledTimes(1);
		const [from, to] = vi.mocked(copyDataFile).mock.calls[0];
		expect(from).toBe(release);
		expect(to.url).toBe('/osm.versatiles');
		expect(to.md5).toBe(release.md5);

		const groups = publishedGroups();
		expect(groups).toHaveLength(1);
		expect(groups[0].latestFile?.md5).toBe(release.md5);
		expect(syncSizeIndices).toHaveBeenCalledWith(groups, 'https://example.com/');
		expect(buildAndUploadSite).toHaveBeenCalledWith(groups, 'https://example.com/');
	});

	it('transfers nothing when R2 is up to date', async () => {
		const release = file('osm.20260608.versatiles', 62 * GB);
		const satellite = file('satellite.versatiles', 1600 * GB);
		given([release, satellite], {
			'/osm.20260608.versatiles': uploaded(release),
			'/osm.versatiles': uploaded(release),
			'/satellite.versatiles': uploaded(satellite),
		});

		await run();

		expect(uploadDataFile).not.toHaveBeenCalled();
		expect(copyDataFile).not.toHaveBeenCalled();
		expect(buildAndUploadSite).toHaveBeenCalled();
	});

	it('should mirror the data before uploading the site (atomic publish)', async () => {
		given([file('osm.20260608.versatiles', 62 * GB)]);

		await run();

		expect(order(uploadDataFile)).toBeLessThan(order(copyDataFile));
		expect(order(copyDataFile)).toBeLessThan(order(syncSizeIndices));
		expect(order(syncSizeIndices)).toBeLessThan(order(buildAndUploadSite));
	});

	it('stops before publishing the site when an upload fails', async () => {
		given([file('osm.20260608.versatiles', 62 * GB)]);
		vi.mocked(uploadDataFile).mockImplementationOnce(() => {
			throw new Error('rclone failed');
		});

		await expect(run()).rejects.toThrow('rclone failed');
		expect(buildAndUploadSite).not.toHaveBeenCalled();
	});

	it('uploads files of any size when there is no limit', async () => {
		const satellite = file('satellite.versatiles', 1600 * GB);
		given([satellite]);

		await run();

		expect(uploadDataFile).toHaveBeenCalledWith(satellite);
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
					' - satellite.versatiles (1700.0 GB)',
					' - elevation.versatiles (400.0 GB)',
					'Uploads greater than 80 GB have to be handled on a real server: run `npm run once` there, without MAX_UPLOAD_GB.',
				].join('\n'),
			);

			// The small upload happened, and the site was published before failing.
			expect(vi.mocked(uploadDataFile).mock.calls).toEqual([[release]]);
			expect(copyDataFile).toHaveBeenCalledTimes(1);
			expect(syncSizeIndices).toHaveBeenCalled();
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
			expect(uploadDataFile).not.toHaveBeenCalled();
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
