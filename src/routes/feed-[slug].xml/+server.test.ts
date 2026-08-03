import { describe, it, expect, vi } from 'vitest';
import type { FileGroupData, FileRefData } from '$lib/data.js';

const { data } = vi.hoisted(() => ({ data: { loadFileGroups: vi.fn() } }));
vi.mock('$lib/data.js', () => data);

const { GET, entries } = await import('./+server.js');

function fileRef(filename: string): FileRefData {
	return {
		fullname: `/home/download/${filename}`,
		filename,
		url: `/${filename}`,
		size: 2 ** 30,
		sizeString: '1.0 GB',
		remotePath: `/home/download/${filename}`,
		hashes: { md5: 'a'.repeat(32), sha256: 'b'.repeat(64) },
	};
}

function group(overrides: Partial<FileGroupData> = {}): FileGroupData {
	return {
		slug: 'osm',
		title: 'OpenStreetMap',
		desc: 'A plain description.',
		order: 0,
		local: true,
		tileType: 'vector',
		latestFile: fileRef('osm.versatiles'),
		olderFiles: [fileRef('osm.20260105.versatiles')],
		...overrides,
	};
}

/** Runs the handler for a slug and returns the response. */
function get(slug: string) {
	// The handler only reads `params`, so the rest of the event is irrelevant.
	return GET({ params: { slug } } as unknown as Parameters<typeof GET>[0]) as Response;
}

/** Text content of every occurrence of an element, unparsed. */
function contentsOf(xml: string, tag: string): string[] {
	return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((match) => match[1]!);
}

describe('entries', () => {
	it('generates one prerender entry per group', () => {
		data.loadFileGroups.mockReturnValue([group(), group({ slug: 'satellite' })]);

		expect(entries()).toEqual([{ slug: 'osm' }, { slug: 'satellite' }]);
	});

	it('generates nothing when no data has been written yet', () => {
		data.loadFileGroups.mockReturnValue([]);

		expect(entries()).toEqual([]);
	});
});

describe('GET', () => {
	it('serves the feed for a known slug', async () => {
		data.loadFileGroups.mockReturnValue([group()]);
		const response = get('osm');

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('application/rss+xml');
		expect(await response.text()).toContain('<title>Versatiles data releases: osm</title>');
	});

	it('lists every older version as an item', async () => {
		data.loadFileGroups.mockReturnValue([
			group({ olderFiles: [fileRef('osm.20260105.versatiles'), fileRef('osm.20251006.versatiles')] }),
		]);
		const xml = await get('osm').text();

		expect(contentsOf(xml, 'item')).toHaveLength(2);
		expect(xml).toContain('https://download.versatiles.org/osm.20260105.versatiles');
	});

	it('returns 404 for an unknown slug', () => {
		data.loadFileGroups.mockReturnValue([group()]);

		expect(get('nope').status).toBe(404);
	});
});

describe('XML escaping', () => {
	/**
	 * Group descriptions are HTML — they contain links and `<br>`. Interpolated
	 * raw, the unclosed `<br>` makes the feed malformed and readers reject it.
	 */
	const HTML_DESC =
		'Tileset in <a href="https://shortbread-tiles.org/schema/">Shortbread</a>.<br>© contributors, A&B';

	it('escapes markup in the channel description', async () => {
		data.loadFileGroups.mockReturnValue([group({ desc: HTML_DESC })]);
		const xml = await get('osm').text();

		const [description] = contentsOf(xml, 'description');
		expect(description).not.toContain('<');
		expect(description).toContain('&lt;a href=');
		expect(description).toContain('&lt;br&gt;');
	});

	it('escapes ampersands so entities stay well-formed', async () => {
		data.loadFileGroups.mockReturnValue([group({ desc: 'A&B' })]);
		const xml = await get('osm').text();

		expect(contentsOf(xml, 'description')[0]).toBe('A&amp;B');
	});

	it('leaves no raw markup in any element content', async () => {
		data.loadFileGroups.mockReturnValue([group({ desc: HTML_DESC })]);
		const xml = await get('osm').text();

		for (const tag of ['title', 'link', 'guid', 'description']) {
			for (const content of contentsOf(xml, tag)) {
				expect(content, `<${tag}> must not contain raw markup`).not.toMatch(/[<>]/);
			}
		}
	});

	it('escapes characters coming from file names', async () => {
		const file = { ...fileRef('osm.versatiles'), url: '/a&b.versatiles' };
		data.loadFileGroups.mockReturnValue([group({ olderFiles: [file] })]);
		const xml = await get('osm').text();

		expect(xml).toContain('/a&amp;b.versatiles');
		expect(xml).not.toContain('/a&b.versatiles');
	});
});
