
export interface BunnyFile {
	id: string;
	filename: string;
	size: number;
	isDirectory: boolean;
	contentType: string;
	checksum: string;
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

	const data = await request.json();

	const files: BunnyFile[] = data.map((item: any) => ({
		id: item.Guid,
		filename: item.ObjectName,
		size: item.Length,
		isDirectory: item.IsDirectory,
		contentType: item.ContentType,
		checksum: item.Checksum
	}));

	return files;
}

export async function upload(content: Buffer, filename: string, mime: string) {

	console.log({ content, filename, mime });
	throw Error();
}
