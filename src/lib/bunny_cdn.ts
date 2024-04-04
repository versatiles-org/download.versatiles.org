import { Redirect } from './files.js';
import env from './env.js';

export async function updateEdgeRules(redirects: Redirect[]) {

	const request = await fetch(
		`https://api.bunny.net/pullzone/${env.pullzone_id}`, {
		method: 'GET',
		headers: {
			'AccessKey': String(env.api_key),
			'Accept': 'application/json',
		}
	})
	if (request.status !== 200) throw Error(request.status + ': ' + request.statusText);
	const response = await request.json();
	const desc2guid = new Map<string, string>(response.EdgeRules.map((e: any) => [e.Description, e.Guid]));


	for (const redirect of redirects) {
		const desc = 'redirect to latest: ' + redirect.link;
		const message = {
			Guid: undefined as (undefined | string),
			ActionType: 2,
			ActionParameter1: `https://${env.domain}/` + redirect.file.name,
			TriggerMatchingType: 0,
			Triggers: [{
				Type: 0,
				PatternMatches: ['*/' + redirect.link],
				PatternMatchingType: 0,
			}],
			Description: desc,
			Enabled: true
		};
		if (desc2guid.has(desc)) message.Guid = desc2guid.get(desc);

		const request = await fetch(
			`https://api.bunny.net/pullzone/${env.pullzone_id}/edgerules/addOrUpdate`, {
			method: 'POST',
			headers: {
				'AccessKey': env.api_key,
				'Accept': 'application/json',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(message)
		})

		if (request.status >= 300) throw Error(request.status + ': ' + request.statusText);

		const response = await request.json();
	}
}

export async function purgeCache(list: string[]) {
	const base = `https://${env.domain}/`;
	for (const entry of list) {
		const url = new URL(entry, base);

		const request = await fetch(
			`https://api.bunny.net/purge?url=${encodeURIComponent(url.href)}&async=true`, {
			method: 'GET',
			headers: {
				'AccessKey': String(env.api_key),
				'Accept': 'application/json',
			}
		})
		if (request.status !== 200) throw Error(request.status + ': ' + request.statusText);
		const response = await request.text();
		console.log(response);
	}
}
