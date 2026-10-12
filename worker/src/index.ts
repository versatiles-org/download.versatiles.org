/**
 * Cloudflare Worker for download.versatiles.org.
 *
 * R2 custom domains serve objects by exact key but have no directory-index
 * behaviour. This Worker fronts the bucket on the public hostname and:
 *
 * - maps `/` (and any path ending in `/`) to `…/index.html`
 * - streams every other key straight from R2 (data files included)
 * - honours HTTP Range / conditional requests, so download resume works —
 *   including `If-Range`, so that a download resumed after the dataset was
 *   replaced restarts instead of being stitched together from two versions
 * - serves permissive CORS so browser `fetch()` works cross-origin
 *
 * Worker → R2 traffic is free, so serving large data files through the Worker
 * still incurs no egress fee. (Alternatively, data keys can be served by R2's
 * own custom domain and the Worker scoped to the site root only.)
 */

export interface Env {
	BUCKET: R2Bucket;
}

/** Directory-index document appended to `/` and trailing-slash paths. */
const INDEX = 'index.html';

/** CORS headers applied to every response. */
const CORS: Record<string, string> = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'GET, HEAD, OPTIONS',
	'access-control-allow-headers': 'range, if-range, if-match, if-none-match, if-modified-since, if-unmodified-since',
	'access-control-expose-headers': 'content-length, content-range, content-type, etag, accept-ranges',
	'access-control-max-age': '86400',
};

/**
 * Resolves a request URL to an R2 object key, or null if the path is not valid
 * percent-encoding (`/%E0`).
 */
function keyForPath(pathname: string): string | null {
	let key: string;
	try {
		key = decodeURIComponent(pathname.replace(/^\/+/, ''));
	} catch {
		return null;
	}
	if (key === '' || key.endsWith('/')) key += INDEX;
	return key;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: CORS });
		}

		if (request.method !== 'GET' && request.method !== 'HEAD') {
			return new Response('Method Not Allowed', {
				status: 405,
				headers: { ...CORS, allow: 'GET, HEAD, OPTIONS' },
			});
		}

		const key = keyForPath(new URL(request.url).pathname);
		if (key === null) return new Response('Bad Request', { status: 400, headers: CORS });

		// HEAD only needs metadata.
		if (request.method === 'HEAD') {
			const head = await env.BUCKET.head(key);
			if (head === null) return notFound();
			const headers = baseHeaders(head, key);
			headers.set('content-length', String(head.size));
			return new Response(null, { headers });
		}

		// GET — let R2 handle Range and conditional (If-None-Match / If-Modified-Since).
		// R2 knows nothing about If-Range, so that one is decided here.
		let range: Headers | undefined = request.headers;
		let onlyIf: R2Conditional | Headers = request.headers;
		let pinned = false;

		const ifRange = request.headers.get('if-range');
		if (ifRange !== null && request.headers.has('range')) {
			const head = await env.BUCKET.head(key);
			if (head === null) return notFound();

			if (ifRangeMatches(ifRange, head)) {
				// Still the version the client has part of. Pin it, so the range cannot
				// come from a replacement uploaded between this check and the read.
				onlyIf = { etagMatches: head.etag };
				pinned = true;
			} else {
				// A different version: the client's partial download is useless, so
				// ignore the range and send the whole object.
				range = undefined;
				onlyIf = {};
			}
		}

		let object = await env.BUCKET.get(key, { range, onlyIf });
		if (object === null) return notFound();

		if (pinned && !objectHasBody(object)) {
			// Replaced in that instant after all — same answer as a failed If-Range.
			range = undefined;
			object = await env.BUCKET.get(key);
			if (object === null) return notFound();
		}

		const headers = baseHeaders(object, key);

		// No body → a condition of the request was not met.
		if (!objectHasBody(object)) {
			const status = preconditionFailed(request.headers, object) ? 412 : 304;
			return new Response(null, { status, headers });
		}

		const body = object as R2ObjectBody;
		let status = 200;
		if (body.range && range !== undefined && range.has('range')) {
			const { offset, length } = resolveRange(body.range, object.size);
			headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
			headers.set('content-length', String(length));
			status = 206;
		} else {
			headers.set('content-length', String(object.size));
		}

		return new Response(body.body, { status, headers });
	},
};

/**
 * Evaluates an `If-Range` header against the current object (RFC 9110 §13.1.5):
 * an entity tag must be identical and strong, a date must not be older than the
 * object.
 */
function ifRangeMatches(ifRange: string, object: R2Object): boolean {
	const value = ifRange.trim();
	if (value.startsWith('"')) return value === object.httpEtag;
	// A weak tag does not identify the exact bytes, so it never qualifies.
	if (value.startsWith('W/')) return false;

	const date = Date.parse(value);
	return !Number.isNaN(date) && wholeSeconds(object.uploaded) <= date;
}

/**
 * Tells which kind of condition R2 found unmet — it only reports *that* one
 * was, by returning the object without a body. `If-Match` and
 * `If-Unmodified-Since` fail with 412 Precondition Failed; `If-None-Match` and
 * `If-Modified-Since` "fail" with 304 Not Modified.
 */
function preconditionFailed(requestHeaders: Headers, object: R2Object): boolean {
	const ifMatch = requestHeaders.get('if-match');
	if (ifMatch !== null) {
		const tags = ifMatch.split(',').map((tag) => tag.trim());
		return !tags.includes('*') && !tags.includes(object.httpEtag);
	}

	// Only consulted when there is no If-Match (RFC 9110 §13.2.2).
	const ifUnmodifiedSince = requestHeaders.get('if-unmodified-since');
	if (ifUnmodifiedSince !== null) {
		const date = Date.parse(ifUnmodifiedSince);
		return !Number.isNaN(date) && wholeSeconds(object.uploaded) > date;
	}

	return false;
}

/** A timestamp without its milliseconds, as HTTP dates carry none. */
function wholeSeconds(date: Date): number {
	return Math.floor(date.getTime() / 1000) * 1000;
}

/** Normalises an `R2Range` (start/length, start-only, or suffix) to `{ offset, length }`. */
function resolveRange(range: R2Range, size: number): { offset: number; length: number } {
	if ('suffix' in range) {
		const length = Math.min(range.suffix, size);
		return { offset: size - length, length };
	}
	const offset = range.offset ?? 0;
	const length = range.length ?? size - offset;
	return { offset, length };
}

/** Builds the common response headers for an R2 object/metadata. */
function baseHeaders(object: R2Object, key: string): Headers {
	const headers = new Headers(CORS);
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);
	headers.set('accept-ranges', 'bytes');
	headers.set('cache-control', cacheControlFor(key));
	return headers;
}

/**
 * Cache-Control by key. Content-addressed objects — dated dataset files and
 * their sidecars (`*.YYYYMMDD.versatiles[.md5|.sha256|.index.json]`) and hashed
 * `_app/immutable/` assets — never change, so cache them forever. Everything
 * else (stable `<slug>.versatiles`, its sidecars, index.html, feeds) gets a
 * short TTL; clients still revalidate cheaply via the ETag / 304 we return.
 *
 * Note the stable size indices (`<slug>.versatiles.index.json`) deliberately fall
 * through to the short TTL: like the data file they describe, they are rewritten
 * in place whenever the dataset is updated.
 */
function cacheControlFor(key: string): string {
	if (/\.\d{8}\.versatiles(\.(md5|sha256|index\.json))?$/.test(key) || key.startsWith('_app/immutable/')) {
		return 'public, max-age=31536000, immutable';
	}
	return 'public, max-age=300';
}

/** Type guard: a fetched R2 object that carries a body. */
function objectHasBody(object: R2Object): object is R2ObjectBody {
	return 'body' in object && (object as R2ObjectBody).body !== null;
}

function notFound(): Response {
	return new Response('Not Found', { status: 404, headers: CORS });
}
