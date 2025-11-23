export class FileResponse {
	url: string;
	content: string;
	constructor(url: string, content: string) {
		if (!url.startsWith('/')) {
			throw new Error(`FileResponse.url must start with '/', got: ${url}`);
		}

		this.url = url;
		this.content = content.replaceAll('\n', '\\n').replaceAll('\t', '\\t');
	}
}
