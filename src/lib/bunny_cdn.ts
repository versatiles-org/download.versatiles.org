import { Redirect } from './files.js';

export async function updateEdgeRules(redirects: Redirect[]) {

	const request = await fetch(
		`https://api.bunny.net/pullzone/${process.env.BUNNY_PULLZONE_ID}`, {
		method: 'GET',
		headers: {
			'AccessKey': String(process.env.BUNNY_API_KEY),
			'Accept': 'application/json',
		}
	})
	const response = await request.json();
	const desc2guid = new Map<string, string>(response.EdgeRules.map((e: any) => [e.Description, e.Guid]));


	for (const redirect of redirects) {
		const desc = 'redirect to latest: ' + redirect.link;
		const message = {
			Guid: undefined as (undefined | string),
			ActionType: 2,
			ActionParameter1: 'https://download.versatiles.org/' + redirect.file.filename,
			TriggerMatchingType: 0,
			Triggers: [{
				Type: 0,
				PatternMatches: ['https://download.versatiles.org/' + redirect.link],
				PatternMatchingType: 0,
			}],
			Description: desc,
			Enabled: true
		};
		if (desc2guid.has(desc)) message.Guid = desc2guid.get(desc);

		const request = await fetch(
			`https://api.bunny.net/pullzone/${process.env.BUNNY_PULLZONE_ID}/edgerules/addOrUpdate`, {
			method: 'POST',
			headers: {
				'AccessKey': String(process.env.BUNNY_API_KEY),
				'Accept': 'application/json',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(message)
		})
		const response = await request.json();
		console.log(response);
	}
}
