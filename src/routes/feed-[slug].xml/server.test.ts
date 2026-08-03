import { describe, it, expect, vi } from 'vitest';
import type { FileGroupData } from '$lib/data.js';

const { data } = vi.hoisted(() => ({ data: { loadFileGroups: vi.fn() } }));
vi.mock('$lib/data.js', () => data);

// Not named `+server.test.ts`: SvelteKit reserves `+`-prefixed files in route
// directories and refuses to build when it finds one it does not recognise.
const { GET, entries } = await import('./+server.js');

function group(slug: string): FileGroupData {
	return {
		slug,
		title: slug,
		desc: ['desc'],
		order: 0,
		local: true,
		tileType: 'vector',
		olderFiles: [],
	};
}

/** Runs the handler for a slug. Only `params` is read, so the rest is irrelevant. */
function get(slug: string): Response {
	return GET({ params: { slug } } as unknown as Parameters<typeof GET>[0]) as Response;
}

describe('entries', () => {
	it('generates one prerender entry per group', () => {
		data.loadFileGroups.mockReturnValue([group('osm'), group('satellite')]);

		expect(entries()).toEqual([{ slug: 'osm' }, { slug: 'satellite' }]);
	});

	it('generates nothing before any data has been written', () => {
		data.loadFileGroups.mockReturnValue([]);

		expect(entries()).toEqual([]);
	});
});

describe('GET', () => {
	it('serves the feed for a known slug', async () => {
		data.loadFileGroups.mockReturnValue([group('osm')]);
		const response = get('osm');

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/rss+xml');
		expect(await response.text()).toContain('<title>Versatiles data releases: osm</title>');
	});

	it('returns 404 for an unknown slug', () => {
		data.loadFileGroups.mockReturnValue([group('osm')]);

		expect(get('nope').status).toBe(404);
	});
});
