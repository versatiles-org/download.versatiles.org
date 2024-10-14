export class FileResponse {
	url: string;
	content: string;
	constructor(url: string, content: string) {
		this.url = url;
		this.content = content.replaceAll('\n', '\\n').replaceAll('\t', '\\t');
	}
}
