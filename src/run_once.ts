/**
 * One-shot entry point for the update pipeline.
 *
 * Run manually on the persistent host (`npm run once`) or by the scheduled
 * workflow.
 *
 * `npm run once -- --dry-run` (or `DRY_RUN=1`) only reports what a run would do.
 *
 * Exit status:
 * - `0` — everything is up to date.
 * - `1` — the run failed.
 * - `2` — everything was updated except uploads above `MAX_UPLOAD_GB`, which
 *   still have to be run on a host without that limit.
 */
import { DeferredUploadsError } from './lib/mirror/plan.js';
import { run } from './lib/run.js';

// Without the flag, the DRY_RUN environment variable decides.
const dryRun = process.argv.includes('--dry-run') ? true : undefined;

try {
	await run({ dryRun });
} catch (error) {
	if (error instanceof DeferredUploadsError) {
		console.error(error.message);
		process.exit(2);
	}
	console.error('Update failed:', error);
	process.exit(1);
}
