import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('./lib/template/template.js', () => ({
	renderTemplate: vi.fn().mockImplementation(() => "test content")
}));

const { app } = await import('./dev.js');
const { renderTemplate } = await import('./lib/template/template.js');

describe('Express App', () => {
	beforeEach(() => (vi.clearAllMocks()));

	it('GET / should return status 200 and the HTML content', async () => {

		const response = await request(app).get('/');

		expect(response.status).toBe(200);
		expect(response.type).toBe('text/html');
		expect(response.text).toBe('test content');

		expect(renderTemplate).toHaveBeenCalledTimes(1);
		expect(renderTemplate).toHaveBeenNthCalledWith(1, expect.any(Array), "index.html");
	});

	it('GET /feed-osm.xml should return status 200 and XML content', async () => {

		const response = await request(app).get('/feed-osm.xml');

		expect(response.status).toBe(200);
		expect(response.type).toBe('application/rss+xml');
		expect(response.text).toBe('test content');

		expect(renderTemplate).toHaveBeenCalledTimes(1);
		expect(renderTemplate).toHaveBeenNthCalledWith(1, expect.any(Array), "feed.xml");
	});
});
