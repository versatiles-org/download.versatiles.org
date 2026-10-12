/**
 * One-shot entry point for the update pipeline.
 *
 * Run manually on the persistent host (`npm run once`). Logs a final status and
 * exits non-zero on failure so the operator / monitoring can detect a bad run.
 * A lock file keeps a second run on the same host from starting meanwhile.
 */
import { acquireLock } from './lib/lock.js';
import { run } from './lib/run.js';

let failed = false;

try {
	const release = acquireLock();
	try {
		await run();
	} finally {
		release();
	}
} catch (error) {
	console.error('Update failed:', error);
	failed = true;
}

// After the lock is released: `process.exit()` does not run pending `finally` blocks.
if (failed) process.exit(1);
