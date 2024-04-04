
export class BunnyFile {
	readonly name: string;
	readonly size: number;
	constructor(name: string, size: number) {
		this.name = name;
		this.size = size;
	}
	getClone(name: string) {
		return new BunnyFile(name, this.size);
	}
	async getMd5() {
		const request = await fetch(
			`https://storage.bunnycdn.com/${process.env.BUNNY_STORAGE_NAME}/${this.name}.md5`, {
			method: 'GET',
			headers: {
				'AccessKey': String(process.env.BUNNY_STORAGE_KEY),
				'Accept': '*/*',
			}
		})
		if (request.status !== 200) throw Error(request.status + ': ' + request.statusText);
		return await request.text();
	}
}

export async function getFileList(): Promise<BunnyFile[]> {
	const request = await fetch(
		`https://storage.bunnycdn.com/${process.env.BUNNY_STORAGE_NAME}/`, {
		method: 'GET',
		headers: {
			'AccessKey': String(process.env.BUNNY_STORAGE_KEY),
			'Accept': 'application/json',
		}
	})
	if (request.status !== 200) throw Error(request.status + ': ' + request.statusText);
	const data = await request.json();

	const files = new Array<BunnyFile>();
	data.forEach((item: any) => {
		if (item.IsDirectory) return;
		if (!item.ObjectName.endsWith('.versatiles')) return;
		files.push(new BunnyFile(item.ObjectName, item.Length));
	});

	return files;
}

export async function upload(content: Buffer, filename: string, mime: string) {
	const request = await fetch(
		`https://storage.bunnycdn.com/${process.env.BUNNY_STORAGE_NAME}/${filename}`, {
		method: 'PUT',
		headers: {
			'AccessKey': String(process.env.BUNNY_STORAGE_KEY),
			'Content-Type': mime,
		},
		body: content
	})
	if (request.status >= 300) throw Error(request.status + ': ' + request.statusText);
	const data = await request.text();
	return
}
