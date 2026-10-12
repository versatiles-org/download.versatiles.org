/**
 * A lock file that keeps two updater runs on the same host from overlapping.
 *
 * Two runs at once would upload the same multi-GB files twice and publish the
 * site from whichever finished last. The lock holds the pid of its owner; a lock
 * whose process no longer exists (a crashed or killed run) is taken over, so it
 * never has to be cleaned up by hand. There is deliberately no age limit: a
 * legitimate run can take more than a day when a 1.7 TB file changes.
 *
 * This only guards one machine. Runs on different machines are kept apart
 * operationally.
 */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';

/** Default location, inside the git-ignored `data/` folder. */
const LOCK_FILE = 'data/.lock';

/**
 * Takes the lock and returns a function that releases it.
 *
 * Throws if another live process holds it.
 */
export function acquireLock(file: string = LOCK_FILE): () => void {
	const path = resolve(file);
	mkdirSync(dirname(path), { recursive: true });
	const content = `${process.pid}\n${new Date().toISOString()}\n`;

	try {
		// `wx` fails if the file exists, so creating it is the atomic test-and-set.
		writeFileSync(path, content, { flag: 'wx' });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;

		const [pid, since] = readFileSync(path, 'utf-8').split('\n');
		if (isAlive(Number(pid))) {
			throw new Error(`Another update is already running (pid ${pid}, started ${since}). Lock file: ${path}`);
		}

		console.log(`Taking over the lock of a run that no longer exists (pid ${pid}, started ${since}).`);
		writeFileSync(path, content);
	}

	return () => {
		try {
			unlinkSync(path);
		} catch {
			// Already gone — nothing left to release.
		}
	};
}

/** True if a process with this pid exists. */
function isAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		// Signal 0 delivers nothing; it only checks that the process can be signalled.
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM: the process exists but belongs to another user.
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}
