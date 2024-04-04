
if (!process.env.BUNNY) {
	// BUNNY should be something like: BUNNY='{"api_key":"???","pullzone_id":123,"storage_key":"???","storage_name":"???","domain":"example.org"}'
	throw Error('missing env BUNNY');
}

let data;
try {
	data = JSON.parse(process.env.BUNNY);
} catch (e) {
	console.log('process.env.BUNNY', process.env.BUNNY);
	throw Error('env BUNNY must be a valid JSON')
}

const values = {
	api_key: data.api_key,
	pullzone_id: data.pullzone_id,
	storage_key: data.storage_key,
	storage_name: data.storage_name,
	domain: data.domain,
}

if ((typeof values.api_key !== 'string') || (values.api_key.length !== 72)) {
	throw Error('api_key must be string of 72 characters')
}

if (typeof values.pullzone_id !== 'number') {
	throw Error('pullzone_id must be number')
}

if ((typeof values.storage_key !== 'string') || (values.storage_key.length !== 41)) {
	throw Error('storage_key must be string of 41 characters')
}

if (typeof values.storage_name !== 'string') {
	throw Error('storage_name must be string')
}

if (typeof values.domain !== 'string') {
	throw Error('domain must be string')
}

export default values as {
	api_key: string;
	pullzone_id: number;
	storage_key: string;
	storage_name: string;
	domain: string;
};
