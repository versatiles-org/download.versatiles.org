import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('run_once', () => {
	const argv = process.argv;
	let exit: ReturnType<typeof vi.spyOn>;
	let err: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
		err = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		process.argv = argv;
		exit.mockRestore();
		err.mockRestore();
	});

	/** Imports the entry point with `run` replaced, as if started with `args`. */
	async function start(run: () => Promise<void>, args: string[] = []): Promise<void> {
		process.argv = ['node', 'run_once.ts', ...args];
		vi.doMock('./lib/run.js', () => ({ run }));
		await import('./run_once.js');
	}

	it('runs the pipeline and does not exit on success', async () => {
		const run = vi.fn().mockResolvedValue(undefined);

		await start(run);

		// Whether this is a dry run is then up to the DRY_RUN environment variable.
		expect(run).toHaveBeenCalledWith({ dryRun: undefined });
		expect(exit).not.toHaveBeenCalled();
	});

	it('asks for a dry run when started with --dry-run', async () => {
		const run = vi.fn().mockResolvedValue(undefined);

		await start(run, ['--dry-run']);

		expect(run).toHaveBeenCalledWith({ dryRun: true });
	});

	it('exits non-zero on failure', async () => {
		const run = vi.fn().mockRejectedValue(new Error('boom'));

		await start(run);

		expect(run).toHaveBeenCalled();
		expect(exit).toHaveBeenCalledWith(1);
	});

	it('exits with status 2 when uploads were deferred', async () => {
		const { DeferredUploadsError } = await import('./lib/mirror/plan.js');
		const { FileRef } = await import('./lib/file/file_ref.js');
		const deferred = new DeferredUploadsError(
			[new FileRef('/home/satellite.versatiles', 2 ** 40, '/home/x')],
			80 * 2 ** 30,
		);

		await start(vi.fn().mockRejectedValue(deferred));

		expect(exit).toHaveBeenCalledWith(2);
		// The message alone — this is a reminder, not a crash with a stack trace.
		expect(err).toHaveBeenCalledWith(deferred.message);
	});
});
