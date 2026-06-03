/**
 * One-shot entry point for the update pipeline.
 *
 * Run manually on the persistent host (`npm run once`). Logs a final status and
 * exits non-zero on failure so the operator / monitoring can detect a bad run.
 */
import { run } from './lib/run.js';

try {
	await run();
} catch (error) {
	console.error('Update failed:', error);
	process.exit(1);
}
