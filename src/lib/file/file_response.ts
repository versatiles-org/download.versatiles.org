/**
 * Represents a small generated object served from R2.
 *
 * Models build-time text payloads — checksum sidecars (`.md5` / `.sha256`),
 * TSV url lists, the HTML page and RSS feeds — that are uploaded to the bucket
 * as real objects (raw content, no escaping).
 *
 * The `url` is the object's HTTP path / R2 key and must start with '/'.
 */
export class FileResponse {
	readonly url: string;
	readonly content: string;
	readonly contentType: string;

	constructor(url: string, content: string, contentType = 'text/plain') {
		if (!url.startsWith('/')) {
			throw new Error(`FileResponse.url must start with '/', got: ${url}`);
		}

		this.url = url;
		this.content = content;
		this.contentType = contentType;
	}
}
