import { describe, it, expect } from 'vitest';
import worker, { type Env } from './index.js';

/**
 * Minimal stand-in for the R2 bindings the worker uses. The worker only calls
 * `head` and `get` and reads a handful of fields back, so a plain object graph
 * is enough — no miniflare needed.
 */
interface StubObject {
	body?: string | null;
	contentType?: string;
	/** Set to emulate R2 resolving a Range request. */
	range?: { offset?: number; length?: number } | { suffix: number };
	/** Set to emulate a conditional request matching (R2 returns no body). */
	notModified?: boolean;
}

function stubEnv(objects: Record<string, StubObject>): Env {
	function build(key: string, withBody: boolean) {
		const stub = objects[key];
		if (!stub) return null;
		const body = stub.body ?? '';

		const object: Record<string, unknown> = {
			size: body.length,
			httpEtag: `"etag-${key}"`,
			writeHttpMetadata: (headers: Headers) => headers.set('content-type', stub.contentType ?? 'text/plain'),
		};
		if (stub.range) object.range = stub.range;
		if (withBody && !stub.notModified) object.body = body;
		return object;
	}

	return {
		BUCKET: {
			head: async (key: string) => build(key, false),
			get: async (key: string) => build(key, true),
		},
	} as unknown as Env;
}

/** Issues a request against the worker with the given bucket contents. */
function fetchWorker(url: string, objects: Record<string, StubObject>, init?: RequestInit) {
	return worker.fetch(new Request(url, init), stubEnv(objects));
}

const INDEX = { 'index.html': { body: '<html></html>', contentType: 'text/html' } };

describe('method handling', () => {
	it('answers preflight with 204 and CORS', async () => {
		const response = await fetchWorker('https://d.example/', INDEX, { method: 'OPTIONS' });

		expect(response.status).toBe(204);
		expect(response.headers.get('access-control-allow-origin')).toBe('*');
	});

	it('rejects writes with 405 and advertises what is allowed', async () => {
		const response = await fetchWorker('https://d.example/', INDEX, { method: 'POST' });

		expect(response.status).toBe(405);
		expect(response.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
	});
});

describe('key resolution', () => {
	it('maps the root to index.html', async () => {
		expect((await fetchWorker('https://d.example/', INDEX)).status).toBe(200);
	});

	it('maps a trailing slash to a directory index', async () => {
		const objects = { 'sub/index.html': { body: 'x' } };
		expect((await fetchWorker('https://d.example/sub/', objects)).status).toBe(200);
	});

	it('decodes percent-encoded keys', async () => {
		const objects = { 'a b.versatiles': { body: 'x' } };
		expect((await fetchWorker('https://d.example/a%20b.versatiles', objects)).status).toBe(200);
	});

	it('returns 404 for a missing key', async () => {
		const response = await fetchWorker('https://d.example/nope.versatiles', {});

		expect(response.status).toBe(404);
		// Even failures must carry CORS, or a cross-origin fetch cannot read them.
		expect(response.headers.get('access-control-allow-origin')).toBe('*');
	});
});

describe('GET', () => {
	it('advertises range support and sets content-length', async () => {
		const response = await fetchWorker('https://d.example/', INDEX);

		expect(response.headers.get('accept-ranges')).toBe('bytes');
		expect(response.headers.get('content-length')).toBe('13');
		expect(response.headers.get('etag')).toBe('"etag-index.html"');
	});

	it('answers a range request with 206 and content-range', async () => {
		const objects = { 'f.versatiles': { body: '0123456789', range: { offset: 2, length: 3 } } };
		const response = await fetchWorker('https://d.example/f.versatiles', objects, {
			headers: { range: 'bytes=2-4' },
		});

		expect(response.status).toBe(206);
		expect(response.headers.get('content-range')).toBe('bytes 2-4/10');
		expect(response.headers.get('content-length')).toBe('3');
	});

	it('resolves a suffix range against the end of the object', async () => {
		const objects = { 'f.versatiles': { body: '0123456789', range: { suffix: 4 } } };
		const response = await fetchWorker('https://d.example/f.versatiles', objects, {
			headers: { range: 'bytes=-4' },
		});

		expect(response.headers.get('content-range')).toBe('bytes 6-9/10');
	});

	it('returns 304 when a conditional request matches', async () => {
		const objects = { 'f.versatiles': { body: 'data', notModified: true } };
		const response = await fetchWorker('https://d.example/f.versatiles', objects, {
			headers: { 'if-none-match': '"etag-f.versatiles"' },
		});

		expect(response.status).toBe(304);
	});
});

describe('HEAD', () => {
	it('returns metadata without a body', async () => {
		const response = await fetchWorker('https://d.example/', INDEX, { method: 'HEAD' });

		expect(response.status).toBe(200);
		expect(response.headers.get('content-length')).toBe('13');
		expect(await response.text()).toBe('');
	});

	it('returns 404 for a missing key', async () => {
		expect((await fetchWorker('https://d.example/nope', {}, { method: 'HEAD' })).status).toBe(404);
	});
});

describe('cache-control', () => {
	/** Reads the Cache-Control the worker assigns to a key. */
	async function cacheControlFor(key: string): Promise<string | null> {
		const response = await fetchWorker(`https://d.example/${key}`, { [key]: { body: 'x' } });
		return response.headers.get('cache-control');
	}

	const IMMUTABLE = 'public, max-age=31536000, immutable';
	const SHORT = 'public, max-age=300';

	it.each([
		['osm.20260105.versatiles', IMMUTABLE],
		['osm.20260105.versatiles.md5', IMMUTABLE],
		['osm.20260105.versatiles.sha256', IMMUTABLE],
		['osm.20260105.versatiles.index.json', IMMUTABLE],
		['_app/immutable/chunks/abc.js', IMMUTABLE],
	])('caches content-addressed %s forever', async (key, expected) => {
		expect(await cacheControlFor(key)).toBe(expected);
	});

	it.each([
		['osm.versatiles', SHORT],
		['osm.versatiles.md5', SHORT],
		// Rewritten in place on every release, exactly like the file it describes.
		['osm.versatiles.index.json', SHORT],
		['satellite.versatiles.index.json', SHORT],
		['index.html', SHORT],
		['feed-osm.xml', SHORT],
	])('revalidates mutable %s', async (key, expected) => {
		expect(await cacheControlFor(key)).toBe(expected);
	});
});
