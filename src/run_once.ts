/**
 * One-shot entry point for the update pipeline.
 *
 * Run manually on the persistent host (`npm run once`) or by the scheduled
 * workflow. A lock file keeps a second run on the same host from starting
 * meanwhile.
 *
 * Exit status:
 * - `0` — everything is up to date.
 * - `1` — the run failed.
 * - `2` — everything was updated except uploads above `MAX_UPLOAD_GB`, which
 *   still have to be run on a host without that limit.
 */
import { acquireLock } from './lib/lock.js';
import { DeferredUploadsError } from './lib/mirror/plan.js';
import { run } from './lib/run.js';

let status = 0;

try {
	const release = acquireLock();
	try {
		await run();
	} finally {
		release();
	}
} catch (error) {
	if (error instanceof DeferredUploadsError) {
		console.error(error.message);
		status = 2;
	} else {
		console.error('Update failed:', error);
		status = 1;
	}
}

// After the lock is released: `process.exit()` does not run pending `finally` blocks.
if (status !== 0) process.exit(status);
