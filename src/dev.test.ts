import { jest } from '@jest/globals';
import request from 'supertest';

jest.unstable_mockModule('./lib/template/template.js', () => ({
	generateHTML: jest.fn().mockImplementation(() => '<html><body>Mock HTML Content</body></html>'),
	buildRSSFeeds: jest.fn().mockImplementation(() => '<rss version="2.0"><channel></channel></rss>')
}));

const { app } = await import('./dev.js');
const { generateHTML, buildRSSFeeds } = await import('./lib/template/template.js');

describe('Express App', () => {
	beforeAll(() => {
	});

	test('GET / should return status 200 and the HTML content', async () => {
		const response = await request(app).get('/');

		expect(response.status).toBe(200);
		expect(response.type).toBe('text/html');
		expect(response.text).toBe('<html><body>Mock HTML Content</body></html>');

		expect(generateHTML).toHaveBeenCalledTimes(1);
		expect(generateHTML).toHaveBeenNthCalledWith(1, expect.any(Array));
	});

	test('GET /feed-osm.xml should return status 200 and XML content', async () => {
		const response = await request(app).get('/feed-osm.xml');

		expect(response.status).toBe(200);
		expect(response.type).toBe('application/rss+xml');
		expect(response.text).toBe('<rss version="2.0"><channel></channel></rss>');

		expect(buildRSSFeeds).toHaveBeenCalledTimes(1);
		expect(buildRSSFeeds).toHaveBeenNthCalledWith(1, expect.any(Array));
	});
});
