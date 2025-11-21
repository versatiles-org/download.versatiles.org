import { jest } from '@jest/globals';
import request from 'supertest';

jest.unstable_mockModule('./lib/template/template.js', () => ({
	renderTemplate: jest.fn().mockImplementation(() => "test content")
}));

const { app } = await import('./dev.js');
const { renderTemplate } = await import('./lib/template/template.js');

describe('Express App', () => {
	beforeAll(() => { });
	afterEach(() => { jest.clearAllMocks() });

	test('GET / should return status 200 and the HTML content', async () => {

		const response = await request(app).get('/');

		expect(response.status).toBe(200);
		expect(response.type).toBe('text/html');
		expect(response.text).toBe('test content');

		expect(renderTemplate).toHaveBeenCalledTimes(1);
		expect(renderTemplate).toHaveBeenNthCalledWith(1, expect.any(Array), "index.html");
	});

	test('GET /feed-osm.xml should return status 200 and XML content', async () => {

		const response = await request(app).get('/feed-osm.xml');

		expect(response.status).toBe(200);
		expect(response.type).toBe('application/rss+xml');
		expect(response.text).toBe('test content');

		expect(renderTemplate).toHaveBeenCalledTimes(1);
		expect(renderTemplate).toHaveBeenNthCalledWith(1, expect.any(Array), "feed.xml");
	});
});
