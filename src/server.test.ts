import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the `run` function from `./lib/run.js`
vi.mock('./lib/run.js', () => ({
	run: vi.fn(),
}));

const { run } = await import('./lib/run.js');
const { app } = await import('./server.js');

describe('server', () => {
	// Mock `process.exit` to avoid terminating the test process
	const exitSpy = vi.spyOn(process, 'exit')
	console.log = vi.fn();
	console.error = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		exitSpy.mockImplementation(
			(() => { /* do nothing */ }) as () => never
		);
	});

	it('GET /update should call run and terminate the process with status 200', async () => {

		// Mock `run` to resolve immediately (to simulate its completion)
		vi.mocked(run).mockResolvedValue(undefined);

		// Use supertest to send a GET request to /update
		const response = await request(app).get('/update');

		// Check that the response contains the expected output
		expect(response.status).toBe(200);
		expect(response.text).toBe('updating');

		// Ensure `run` was called
		expect(run).toHaveBeenCalled();

		// Ensure `process.exit(0)` was called
		expect(exitSpy).toHaveBeenCalledWith(0);
	});

	it('SIGINT should trigger process.exit with code 0', () => {
		// Simulate SIGINT signal
		process.emit('SIGINT');

		// Ensure that `process.exit(0)` was called
		expect(exitSpy).toHaveBeenCalledWith(0);

		// Restore the original `process.exit`
		exitSpy.mockRestore();
	});
});
