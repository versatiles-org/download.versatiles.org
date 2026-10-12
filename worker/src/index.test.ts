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
	/** Set to emulate a condition of the request not being met (R2 returns no body). */
	notModified?: boolean;
	/** Entity tag without quotes; defaults to `etag-<key>`. */
	etag?: string;
	/** Upload time; defaults to 2026-01-01. */
	uploaded?: Date;
	/** Replaces the object after this many reads, to emulate an upload in between. */
	replacedAfter?: { reads: number; by: StubObject };
}

/** The options of every `get` issued against a stub bucket. */
type GetOptions = { range?: Headers; onlyIf?: Headers | { etagMatches?: string } } | undefined;

function stubEnv(objects: Record<string, StubObject>, gets: GetOptions[] = []): Env {
	const reads: Record<string, number> = {};

	function current(key: string): StubObject | undefined {
		let stub = objects[key];
		if (stub?.replacedAfter && (reads[key] ?? 0) >= stub.replacedAfter.reads) stub = stub.replacedAfter.by;
		return stub;
	}

	function build(key: string, options?: GetOptions, withBody = false) {
		const stub = current(key);
		reads[key] = (reads[key] ?? 0) + 1;
		if (!stub) return null;
		const body = stub.body ?? '';
		const etag = stub.etag ?? `etag-${key}`;

		const object: Record<string, unknown> = {
			size: body.length,
			etag,
			httpEtag: `"${etag}"`,
			uploaded: stub.uploaded ?? new Date('2026-01-01T00:00:00Z'),
			writeHttpMetadata: (headers: Headers) => headers.set('content-type', stub.contentType ?? 'text/plain'),
		};
		// R2 only resolves a range it was asked for.
		if (stub.range && options?.range) object.range = stub.range;

		const onlyIf = options?.onlyIf;
		const pinFailed = onlyIf !== undefined && !(onlyIf instanceof Headers) && 'etagMatches' in onlyIf && onlyIf.etagMatches !== etag;
		if (withBody && !stub.notModified && !pinFailed) object.body = body;
		return object;
	}

	return {
		BUCKET: {
			head: async (key: string) => build(key),
			get: async (key: string, options?: GetOptions) => {
				gets.push(options);
				return build(key, options, true);
			},
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

describe('malformed URLs', () => {
	it.each(['/%E0', '/%', '/osm%ZZ.versatiles'])('answers %s with 400 instead of failing', async (path) => {
		const response = await fetchWorker(`https://d.example${path}`, INDEX);

		expect(response.status).toBe(400);
		expect(response.headers.get('access-control-allow-origin')).toBe('*');
	});
});

describe('preconditions', () => {
	const unmet = { 'f.versatiles': { body: 'data', notModified: true } };

	/** Status of a GET whose condition R2 reports as not met. */
	async function statusFor(headers: Record<string, string>, objects: Record<string, StubObject> = unmet) {
		return (await fetchWorker('https://d.example/f.versatiles', objects, { headers })).status;
	}

	it('answers a failed If-Match with 412', async () => {
		expect(await statusFor({ 'if-match': '"some-other-version"' })).toBe(412);
	});

	it('answers a failed If-Match list with 412', async () => {
		expect(await statusFor({ 'if-match': '"a", "b"' })).toBe(412);
	});

	it('answers a failed If-Unmodified-Since with 412', async () => {
		// The object was uploaded on 2026-01-01, after the date the client allows.
		expect(await statusFor({ 'if-unmodified-since': 'Mon, 01 Dec 2025 00:00:00 GMT' })).toBe(412);
	});

	it('keeps 304 for If-None-Match and If-Modified-Since', async () => {
		expect(await statusFor({ 'if-none-match': '"etag-f.versatiles"' })).toBe(304);
		expect(await statusFor({ 'if-modified-since': 'Thu, 01 Jan 2026 00:00:00 GMT' })).toBe(304);
	});

	it('answers 304 when If-Match holds and it was If-None-Match that matched', async () => {
		expect(await statusFor({ 'if-match': '"etag-f.versatiles"', 'if-none-match': '"etag-f.versatiles"' })).toBe(304);
		expect(await statusFor({ 'if-match': '*', 'if-none-match': '"etag-f.versatiles"' })).toBe(304);
	});

	it('carries CORS and the current etag on a 412', async () => {
		const response = await fetchWorker('https://d.example/f.versatiles', unmet, {
			headers: { 'if-match': '"some-other-version"' },
		});

		expect(response.headers.get('access-control-allow-origin')).toBe('*');
		expect(response.headers.get('etag')).toBe('"etag-f.versatiles"');
	});
});

describe('If-Range', () => {
	const FILE = { body: '0123456789', range: { offset: 4 } };

	/** Resumes a download of `f.versatiles` at byte 4 with the given validator. */
	function resume(ifRange: string, object: StubObject = FILE, gets: GetOptions[] = []) {
		const request = new Request('https://d.example/f.versatiles', { headers: { range: 'bytes=4-', 'if-range': ifRange } });
		return worker.fetch(request, stubEnv({ 'f.versatiles': object }, gets));
	}

	it('continues the download when the entity tag still matches', async () => {
		const gets: GetOptions[] = [];
		const response = await resume('"etag-f.versatiles"', FILE, gets);

		expect(response.status).toBe(206);
		expect(response.headers.get('content-range')).toBe('bytes 4-9/10');
		// The read is pinned to the version that was checked.
		expect(gets).toHaveLength(1);
		expect(gets[0]?.onlyIf).toEqual({ etagMatches: 'etag-f.versatiles' });
	});

	it('sends the whole new object when the dataset was replaced', async () => {
		const gets: GetOptions[] = [];
		const response = await resume('"etag-of-the-previous-release"', FILE, gets);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-range')).toBeNull();
		expect(response.headers.get('content-length')).toBe('10');
		expect(await response.text()).toBe('0123456789');
		expect(gets[0]?.range).toBeUndefined();
	});

	it('never continues on a weak entity tag', async () => {
		expect((await resume('W/"etag-f.versatiles"')).status).toBe(200);
	});

	it('continues when the object is not newer than the given date', async () => {
		expect((await resume('Thu, 01 Jan 2026 00:00:00 GMT')).status).toBe(206);
		expect((await resume('Fri, 02 Jan 2026 00:00:00 GMT')).status).toBe(206);
	});

	it('sends the whole object when it is newer than the given date', async () => {
		expect((await resume('Wed, 31 Dec 2025 00:00:00 GMT')).status).toBe(200);
	});

	it('ignores sub-second differences, which HTTP dates cannot express', async () => {
		const object = { ...FILE, uploaded: new Date('2026-01-01T00:00:00.700Z') };

		expect((await resume('Thu, 01 Jan 2026 00:00:00 GMT', object)).status).toBe(206);
	});

	it('sends the whole object for a validator it cannot read', async () => {
		expect((await resume('yesterday-ish')).status).toBe(200);
	});

	it('sends the whole new object when it is replaced between the check and the read', async () => {
		const replacement = { body: 'NEW RELEASE', etag: 'etag-new', range: { offset: 4 } };
		const gets: GetOptions[] = [];
		const response = await resume('"etag-f.versatiles"', { ...FILE, replacedAfter: { reads: 1, by: replacement } }, gets);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe('NEW RELEASE');
		expect(response.headers.get('etag')).toBe('"etag-new"');
		expect(response.headers.get('content-range')).toBeNull();
		expect(gets).toHaveLength(2);
	});

	it('is ignored without a Range header', async () => {
		const gets: GetOptions[] = [];
		const request = new Request('https://d.example/f.versatiles', { headers: { 'if-range': '"anything"' } });
		const response = await worker.fetch(request, stubEnv({ 'f.versatiles': { body: '0123456789' } }, gets));

		expect(response.status).toBe(200);
		expect(gets[0]?.onlyIf).toBeInstanceOf(Headers);
	});

	it('answers 404 for a missing key', async () => {
		const request = new Request('https://d.example/nope.versatiles', { headers: { range: 'bytes=4-', 'if-range': '"x"' } });

		expect((await worker.fetch(request, stubEnv({}))).status).toBe(404);
	});
});

describe('CORS', () => {
	it('allows the headers a resuming, validating client sends', async () => {
		const response = await fetchWorker('https://d.example/', INDEX, { method: 'OPTIONS' });
		const allowed = response.headers.get('access-control-allow-headers')?.split(', ');

		expect(allowed).toEqual(expect.arrayContaining(['range', 'if-range', 'if-match', 'if-none-match']));
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
