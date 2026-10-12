/**
 * Decides, before anything is transferred, what a run will do with each data
 * file on the Storage Box — and what will therefore exist on R2 afterwards.
 *
 * Every file is compared with the object under its own key
 * (`/osm.20260608.versatiles`, `/satellite.versatiles`):
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
 * This module only decides. It is a pure function of the scan and a listing of
 * the bucket, which is what makes a dry run possible.
 */
import { FileRef } from '../file/file_ref.js';
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
