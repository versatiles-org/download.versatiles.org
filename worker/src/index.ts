/**
 * Cloudflare Worker for download.versatiles.org.
 *
 * R2 custom domains serve objects by exact key but have no directory-index
 * behaviour. This Worker fronts the bucket on the public hostname and:
 *
 * - maps `/` (and any path ending in `/`) to `…/index.html`
 * - streams every other key straight from R2 (data files included)
 * - honours HTTP Range / conditional requests, so download resume works
 * - serves permissive CORS so browser `fetch()` works cross-origin
 *
 * Worker → R2 traffic is free, so serving large data files through the Worker
 * still incurs no egress fee. (Alternatively, data keys can be served by R2's
 * own custom domain and the Worker scoped to the site root only — see README.)
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
	'access-control-allow-headers': 'range, if-none-match, if-modified-since',
	'access-control-expose-headers': 'content-length, content-range, content-type, etag, accept-ranges',
	'access-control-max-age': '86400',
};

/** Resolves a request URL to an R2 object key. */
function keyForPath(pathname: string): string {
	let key = decodeURIComponent(pathname.replace(/^\/+/, ''));
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

		// HEAD only needs metadata.
		if (request.method === 'HEAD') {
			const head = await env.BUCKET.head(key);
			if (head === null) return notFound();
			const headers = baseHeaders(head, key);
			headers.set('content-length', String(head.size));
			return new Response(null, { headers });
		}

		// GET — let R2 handle Range and conditional (If-None-Match / If-Modified-Since).
		const object = await env.BUCKET.get(key, {
			range: request.headers,
			onlyIf: request.headers,
		});

		if (object === null) return notFound();

		const headers = baseHeaders(object, key);

		// No body → conditional request matched (304 Not Modified).
		if (!objectHasBody(object)) {
			return new Response(null, { status: 304, headers });
		}

		const body = object as R2ObjectBody;
		let status = 200;
		if (body.range && request.headers.has('range')) {
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
 * their sidecars (`*.YYYYMMDD.versatiles[.md5|.sha256]`) and hashed
 * `_app/immutable/` assets — never change, so cache them forever. Everything
 * else (stable `<slug>.versatiles`, its sidecars, index.html, feeds) gets a
 * short TTL; clients still revalidate cheaply via the ETag / 304 we return.
 */
function cacheControlFor(key: string): string {
	if (/\.\d{8}\.versatiles(\.(md5|sha256))?$/.test(key) || key.startsWith('_app/immutable/')) {
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
