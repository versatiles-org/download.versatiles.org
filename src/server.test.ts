import request from 'supertest';
import { jest } from '@jest/globals';

// Mock the `run` function from `./lib/run.js`
jest.unstable_mockModule('./lib/run.js', () => ({
	run: jest.fn(),
}));

const { run } = await import('./lib/run.js');
const { app } = await import('./server.js');

describe('server', () => {
	// Mock `process.exit` to avoid terminating the test process
	const exitSpy = jest.spyOn(process, 'exit')
	jest.spyOn(console, 'log').mockReturnValue();

	beforeEach(() => {
		jest.clearAllMocks();
		exitSpy.mockImplementation(
			(() => { /* do nothing */ }) as () => never
		);
	});

	test('GET /update should call run and terminate the process with status 200', async () => {

		// Mock `run` to resolve immediately (to simulate its completion)
		(run as jest.Mock<() => Promise<undefined>>).mockResolvedValue(undefined);

		// Use supertest to send a GET request to /update
		const response = await request(app).get('/update');

		// Check that the response contains the expected output
		expect(response.status).toBe(200);
		expect(response.text).toContain('updating');
		expect(response.text).toContain('restarting');

		// Ensure `run` was called
		expect(run).toHaveBeenCalled();

		// Ensure `process.exit(0)` was called
		expect(exitSpy).toHaveBeenCalledWith(0);
	});

	test('SIGINT should trigger process.exit with code 0', () => {
		// Simulate SIGINT signal
		process.emit('SIGINT');

		// Ensure that `process.exit(0)` was called
		expect(exitSpy).toHaveBeenCalledWith(0);

		// Restore the original `process.exit`
		exitSpy.mockRestore();
	});
});
