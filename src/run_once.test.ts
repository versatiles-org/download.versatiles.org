import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('run_once', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it('runs the pipeline and does not exit on success', async () => {
		const run = vi.fn().mockResolvedValue(undefined);
		vi.doMock('./lib/run.js', () => ({ run }));
		const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

		await import('./run_once.js');

		expect(run).toHaveBeenCalled();
		expect(exit).not.toHaveBeenCalled();
		exit.mockRestore();
	});

	it('exits non-zero on failure', async () => {
		const run = vi.fn().mockRejectedValue(new Error('boom'));
		vi.doMock('./lib/run.js', () => ({ run }));
		const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
		const err = vi.spyOn(console, 'error').mockImplementation(() => { });

		await import('./run_once.js');

		expect(run).toHaveBeenCalled();
		expect(exit).toHaveBeenCalledWith(1);
		exit.mockRestore();
		err.mockRestore();
	});
});
