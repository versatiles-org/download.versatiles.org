import { jest } from '@jest/globals';
import request from 'supertest';

jest.unstable_mockModule('./lib/html/html.js', () => ({
	buildHTML: jest.fn().mockImplementation(() => '<html><body>Mock HTML Content</body></html>')
}));

const { app } = await import('./dev.js');
const { buildHTML } = await import('./lib/html/html.js');

describe('Express App', () => {
	beforeAll(() => {
	});

	test('GET / should return status 200 and the HTML content', async () => {
		const response = await request(app).get('/');

		expect(response.status).toBe(200);
		expect(response.type).toBe('text/html');
		expect(response.text).toBe('<html><body>Mock HTML Content</body></html>');

		expect(buildHTML).toHaveBeenCalledTimes(1);
		expect(buildHTML).toHaveBeenNthCalledWith(1, expect.any(Array));
	});
});
