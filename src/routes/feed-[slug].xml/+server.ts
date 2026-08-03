import { loadFileGroups } from '$lib/data.js';
import { buildRssFeed } from '$lib/feed.js';
import type { EntryGenerator, RequestHandler } from './$types.js';

export const prerender = true;

export const entries: EntryGenerator = () => {
	return loadFileGroups().map((g) => ({ slug: g.slug }));
};

export const GET: RequestHandler = ({ params }) => {
	const groups = loadFileGroups();
	const group = groups.find((g) => g.slug === params.slug);

	if (!group) {
		return new Response('Not found', { status: 404 });
	}

	return new Response(buildRssFeed(group), {
		headers: { 'Content-Type': 'application/rss+xml' },
	});
};
