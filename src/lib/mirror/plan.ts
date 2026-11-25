/**
 * Decides, before anything is transferred, what a run will do with each data
 * file on the Storage Box — and what will therefore exist on R2 afterwards.
 *
 * Every file is compared with the object under its own key
 * (`/osm-vector/osm-vector.20260608.versatiles`, `/satellite-raster/satellite-raster.versatiles`):
 *
 * | R2 object                         | size vs. limit | action                               |
 * | --------------------------------- | -------------- | ------------------------------------ |
 * | same md5 **and** same size        | —              | `skip`                               |
 * | missing or different              | within limit   | `upload`                             |
 * | different, describable            | above limit    | `defer`, keep publishing the old one |
 * | missing, or without checksums     | above limit    | `defer`, publish nothing             |
 *
 * The size is compared as well as the md5 because the md5 on R2 is metadata the
 * updater wrote itself when it started the upload; it does not prove that the
 * bytes arrived.
 *
 * **Deferring.** A run can be given a size limit (`MAX_UPLOAD_GB`), for hosts
 * that cannot move a file of hundreds of GB. Uploads above it are left for a run
 * without a limit. Until then the site must keep describing what R2 actually
 * serves, so `published` is the list of files *as they will exist on R2 once the
 * plan is executed* — and the site is built from that list, not from the scan:
 *
 * - a deferred file whose previous version is on R2 is represented by that
 *   version (its size and checksums, read from R2);
 * - a deferred file with nothing usable on R2 is left out;
 * - everything else is the scanned file.
 *
 * **Stable keys.** A dated release (`/osm-vector/osm-vector.20260608.versatiles`) is also published
 * under an undated key (`/osm-vector/osm-vector.versatiles`). That second object is a copy made
 * inside R2 from the first, planned by `planStableCopies()` once the published
 * files are grouped. No bytes leave R2 for it, so the size limit does not apply.
 *
 * **Old releases.** Only the newest `RELEASES_KEPT` releases of a dataset are
 * published. `planDeletions()` picks the older ones still on R2 for deletion,
 * which happens after the site is uploaded, so the site never links to a
 * deleted file.
 *
 * This module only decides. It is a pure function of the scan and a listing of
 * the bucket, which is what makes a dry run possible.
 */
import { RELEASES_KEPT, datasetOf } from '../file/datasets.js';
import type { FileGroup } from '../file/file_group.js';
import { FileRef, formatSize } from '../file/file_ref.js';
import type { RemoteObject } from './rclone.js';

/** What happens to one scanned file. */
export type MirrorAction =
	| { type: 'skip'; file: FileRef }
	| { type: 'upload'; file: FileRef }
	| {
			type: 'defer';
			file: FileRef;
			/** The version that stays published meanwhile, or null if there is none. */
			published: FileRef | null;
	  };

export interface MirrorPlan {
	/** One action per scanned file, in the order given. */
	actions: MirrorAction[];
	/** The data files as they will exist on R2 after the plan is executed. */
	published: FileRef[];
}

export interface PlanOptions {
	/** Largest file, in bytes, that may be uploaded. Undefined: no limit. */
	maxUploadBytes?: number;
}

/**
 * Plans the mirror of `files` (hashes populated) against `remote`, the data
 * files currently on R2 keyed by url.
 */
export function planMirror(files: FileRef[], remote: Map<string, RemoteObject>, options: PlanOptions = {}): MirrorPlan {
	const limit = options.maxUploadBytes ?? Infinity;
	const actions: MirrorAction[] = [];
	const published: FileRef[] = [];

	for (const file of files) {
		const object = remote.get(file.url);

		if (object && object.md5 === file.md5 && object.size === file.size) {
			actions.push({ type: 'skip', file });
			published.push(file);
		} else if (file.size <= limit) {
			actions.push({ type: 'upload', file });
			published.push(file);
		} else {
			const current = object ? describeRemote(file, object) : null;
			actions.push({ type: 'defer', file, published: current });
			if (current) published.push(current);
		}
	}

	return { actions, published };
}

/**
 * The object currently on R2 under a file's key, as a `FileRef` — or null if it
 * carries no checksums (e.g. it was copied by hand), since the site could then
 * not publish sidecars for it.
 */
function describeRemote(file: FileRef, object: RemoteObject): FileRef | null {
	if (!object.md5 || !object.sha256) return null;

	const current = new FileRef(file.fullname, object.size, file.remotePath);
	current.hashes = { md5: object.md5, sha256: object.sha256 };
	return current;
}

/** The files a plan leaves for a run without a size limit. */
export function deferredFiles(plan: MirrorPlan): FileRef[] {
	return plan.actions.filter((action) => action.type === 'defer').map((action) => action.file);
}

/** A copy within R2: a release (`from`) to the stable key of its dataset (`to`). */
export interface StableCopy {
	from: FileRef;
	to: FileRef;
}

/**
 * Plans the copies that bring each dataset's stable key in line with its latest
 * release. `groups` are the grouped *published* files; `remote` is the same
 * listing the mirror was planned against.
 *
 * A dataset whose only file is undated needs none: that file already sits under
 * the stable key.
 */
export function planStableCopies(groups: FileGroup[], remote: Map<string, RemoteObject>): StableCopy[] {
	const copies: StableCopy[] = [];

	for (const group of groups) {
		const latest = group.latestFile;
		const release = releaseOf(group);
		if (!latest || !release) continue;

		const object = remote.get(latest.url);
		if (object && object.md5 === latest.md5 && object.size === latest.size) continue;

		copies.push({ from: release, to: latest });
	}

	return copies;
}

/**
 * The dated release a group's stable key is a copy of, or null if the group's
 * latest file is not published under a second key.
 *
 * `groupFiles()` clones the newest dated file into `latestFile` (with the date
 * removed from its url) and leaves the original at the head of `olderFiles`.
 */
export function releaseOf(group: FileGroup): FileRef | null {
	const latest = group.latestFile;
	const release = group.olderFiles[0];
	if (!latest || !release || release.url === latest.url || release.md5 !== latest.md5) return null;
	return release;
}

/** A release to delete from R2 because its dataset has `RELEASES_KEPT` newer ones. */
export interface Deletion {
	/** The url of the data file (`/osm-vector/osm-vector.20240101.versatiles`). */
	url: string;
	/** Its size on R2 in bytes. */
	size: number;
}

/**
 * The only kind of key the updater ever deletes: a dated release in its
 * dataset's folder, `/<slug>/<slug>.<YYYYMMDD>.versatiles`. Stable keys, site
 * files and anything else never match.
 */
const DATED_RELEASE = /^\/([^/]+)\/\1\.\d{8}\.versatiles$/;

/**
 * Plans which dated releases to delete from R2. `published` is the plan's list
 * of files as they will be on R2; `remote` is the listing the mirror was
 * planned against.
 *
 * Per dataset, the newest `RELEASES_KEPT` releases are kept, counted over what
 * R2 holds **and** what will be published. Counting R2 means an incomplete scan
 * of the Storage Box can never make a run delete one of the newest releases. On
 * top of that, nothing the site will list is deleted, and nothing of a dataset
 * that is not in `datasets.ts`.
 */
export function planDeletions(published: FileRef[], remote: Map<string, RemoteObject>): Deletion[] {
	const listed = new Set(published.map((file) => file.url));
	const bySlug = new Map<string, string[]>();
	for (const url of new Set([...remote.keys(), ...listed])) {
		const slug = DATED_RELEASE.exec(url)?.[1];
		if (slug === undefined || !datasetOf(slug)) continue;
		bySlug.set(slug, [...(bySlug.get(slug) ?? []), url]);
	}

	return [...bySlug.values()]
		.flatMap((urls) => urls.sort().reverse().slice(RELEASES_KEPT))
		.filter((url) => !listed.has(url))
		.flatMap((url) => {
			const object = remote.get(url);
			return object ? [{ url, size: object.size }] : [];
		});
}

/**
 * A short, human-readable account of what a plan will do. `indices` are the
 * files whose size index will be built, if the caller has worked that out.
 */
export function describePlan(
	plan: MirrorPlan,
	copies: StableCopy[] = [],
	indices: FileRef[] = [],
	deletions: Deletion[] = [],
): string {
	const lines: string[] = [];
	let unchanged = 0;

	for (const action of plan.actions) {
		const label = `${action.file.filename} (${action.file.sizeString})`;
		if (action.type === 'skip') unchanged++;
		else if (action.type === 'upload') lines.push(` - upload ${label}`);
		else if (action.published) lines.push(` - defer  ${label} — too large; the version on R2 stays published`);
		else lines.push(` - defer  ${label} — too large; not on R2 yet, so not published`);
	}
	for (const file of indices) {
		lines.push(` - index  ${file.filename} — build the size index`);
	}
	for (const { from, to } of copies) {
		lines.push(` - copy   ${from.filename} -> ${to.filename} within R2`);
	}
	for (const { url, size } of deletions) {
		lines.push(
			` - delete ${url.replace(/^.*\//, '')} (${formatSize(size)}) from R2 with its checksums and size index — older than the newest ${RELEASES_KEPT} releases`,
		);
	}
	lines.push(` - ${unchanged} data file${unchanged === 1 ? '' : 's'} unchanged`);

	return lines.join('\n');
}

/**
 * Thrown at the very end of a run that did everything except the uploads above
 * its size limit. It is a reminder rather than a malfunction: the site is
 * published and consistent, but a run without a limit is still owed.
 */
export class DeferredUploadsError extends Error {
	constructor(
		public readonly files: FileRef[],
		maxUploadBytes: number,
	) {
		const limit = `${Number((maxUploadBytes / 2 ** 30).toFixed(1))} GB`;
		const count = files.length === 1 ? '1 upload' : `${files.length} uploads`;
		super(
			[
				`Update complete, but ${count} greater than ${limit} ${files.length === 1 ? 'was' : 'were'} skipped:`,
				...files.map((file) => ` - ${file.filename} (${file.sizeString})`),
				`Uploads greater than ${limit} have to be handled on a real server: run \`npm run once\` there, without MAX_UPLOAD_GB.`,
			].join('\n'),
		);
		this.name = 'DeferredUploadsError';
	}
}
