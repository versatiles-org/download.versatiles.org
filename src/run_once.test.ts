import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('run_once', () => {
	const release = vi.fn();
	const acquireLock = vi.fn();

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		acquireLock.mockReturnValue(release);
		vi.doMock('./lib/lock.js', () => ({ acquireLock }));
	});

	it('runs the pipeline and does not exit on success', async () => {
		const run = vi.fn().mockResolvedValue(undefined);
		vi.doMock('./lib/run.js', () => ({ run }));
		const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

		await import('./run_once.js');

		expect(run).toHaveBeenCalled();
		expect(release).toHaveBeenCalled();
		expect(exit).not.toHaveBeenCalled();
		exit.mockRestore();
	});

	it('exits non-zero on failure', async () => {
		const run = vi.fn().mockRejectedValue(new Error('boom'));
		vi.doMock('./lib/run.js', () => ({ run }));
		const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});

		await import('./run_once.js');

		expect(run).toHaveBeenCalled();
		expect(exit).toHaveBeenCalledWith(1);
		// Released before exiting, or the next run would find a lock to take over.
		expect(release.mock.invocationCallOrder[0]).toBeLessThan(exit.mock.invocationCallOrder[0]);
		exit.mockRestore();
		err.mockRestore();
	});

	it('does not start the pipeline while another run holds the lock', async () => {
		const run = vi.fn();
		vi.doMock('./lib/run.js', () => ({ run }));
		acquireLock.mockImplementation(() => {
			throw new Error('Another update is already running');
		});
		const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});

		await import('./run_once.js');

		expect(run).not.toHaveBeenCalled();
		// Not ours to release.
		expect(release).not.toHaveBeenCalled();
		expect(exit).toHaveBeenCalledWith(1);
		exit.mockRestore();
		err.mockRestore();
	});
});
