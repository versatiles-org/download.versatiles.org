import { Redirect } from './files.js';

export async function updateEdgeRules(redirects: Redirect[]) {
	for (const redirect of redirects) {
		const body = JSON.stringify({
			//Guid: redirect.link,
			ActionType: 2,
			ActionParameter1: 'https://download.versatiles.org/' + redirect.file.filename,
			TriggerMatchingType: 0,
			Triggers: [{
				Type: 0,
				PatternMatches: ['https://download.versatiles.org/' + redirect.link],
				PatternMatchingType: 0,
			}],
			Description: 'redirect ' + redirect.link,
			Enabled: true
		});
		console.log(redirect, body);
		const request = await fetch(
			`https://api.bunny.net/pullzone/${process.env.BUNNY_PULLZONE_ID}/edgerules/addOrUpdate`, {
			method: 'POST',
			headers: {
				'AccessKey': String(process.env.BUNNY_API_KEY),
				'Accept': 'application/json',
				'Content-Type': 'application/json',
			},
			body
		})
		const response = await request.json();
		console.log(response);
	}
}
