import { describe, it, expect } from 'vitest';
import { buildRssFeed, escapeXml } from './feed.js';
import type { FileGroupData, FileRefData } from './data.js';

function fileRef(filename: string, overrides: Partial<FileRefData> = {}): FileRefData {
	return {
		fullname: `/home/download/${filename}`,
		filename,
		url: `/${filename}`,
		size: 2 ** 30,
		sizeString: '1.0 GB',
		remotePath: `/home/download/${filename}`,
		hashes: { md5: 'a'.repeat(32), sha256: 'b'.repeat(64) },
		...overrides,
	};
}

function group(overrides: Partial<FileGroupData> = {}): FileGroupData {
	return {
		slug: 'osm',
		title: 'OpenStreetMap',
		desc: ['A plain description.'],
		order: 0,
		local: true,
		tileType: 'vector',
		latestFile: fileRef('osm.versatiles'),
		olderFiles: [fileRef('osm.20260105.versatiles')],
		...overrides,
	};
}

/** Text content of every occurrence of an element, unparsed. */
function contentsOf(xml: string, tag: string): string[] {
	return [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((match) => match[1]!);
}

describe('escapeXml', () => {
	it('escapes the three characters that break element content', () => {
		expect(escapeXml('<a href="x">A & B</a>')).toBe('&lt;a href="x"&gt;A &amp; B&lt;/a&gt;');
	});

	it('escapes ampersands before the entities it introduces', () => {
		// Escaping '<' first would turn '&lt;' back into '&amp;lt;'.
		expect(escapeXml('<')).toBe('&lt;');
		expect(escapeXml('&')).toBe('&amp;');
	});

	it('leaves ordinary text untouched', () => {
		expect(escapeXml('osm.20260105.versatiles')).toBe('osm.20260105.versatiles');
	});
});

describe('buildRssFeed', () => {
	it('titles the channel after the group', () => {
		expect(buildRssFeed(group())).toContain('<title>Versatiles data releases: osm</title>');
	});

	it('emits one item per older version', () => {
		const feed = buildRssFeed(
			group({ olderFiles: [fileRef('osm.20260105.versatiles'), fileRef('osm.20251006.versatiles')] }),
		);

		expect(contentsOf(feed, 'item')).toHaveLength(2);
		expect(feed).toContain('<link>https://download.versatiles.org/osm.20260105.versatiles</link>');
	});

	it('omits items when a group has no older versions', () => {
		expect(contentsOf(buildRssFeed(group({ olderFiles: [] })), 'item')).toHaveLength(0);
	});

	it('identifies each item by name and checksum', () => {
		expect(buildRssFeed(group())).toContain(`<guid>osm.20260105.versatiles;${'a'.repeat(32)}</guid>`);
	});
});

describe('well-formedness', () => {
	/**
	 * Real group descriptions are several lines, each of which may contain inline
	 * HTML such as attribution links.
	 */
	const HTML_DESC = [
		'Tileset in <a href="https://shortbread-tiles.org/schema/">Shortbread</a>.',
		'© contributors, A&B',
	];

	it('escapes markup in the channel description', () => {
		const [description] = contentsOf(buildRssFeed(group({ desc: HTML_DESC })), 'description');

		expect(description).not.toContain('<');
		expect(description).toContain('&lt;a href=');
	});

	it('separates description lines with a newline, never a <br>', () => {
		const feed = buildRssFeed(group({ desc: HTML_DESC }));
		const [description] = contentsOf(feed, 'description');

		// `<br>` has no closing tag, and XML has no void elements: joining the
		// lines with one is what made four of the six published feeds malformed.
		expect(feed).not.toContain('<br>');
		expect(description).toBe(
			'Tileset in &lt;a href="https://shortbread-tiles.org/schema/"&gt;Shortbread&lt;/a&gt;.\n© contributors, A&amp;B',
		);
	});

	it('escapes ampersands so entities stay well-formed', () => {
		expect(contentsOf(buildRssFeed(group({ desc: ['A&B'] })), 'description')[0]).toBe('A&amp;B');
	});

	it('renders a single-line description without a separator', () => {
		expect(contentsOf(buildRssFeed(group({ desc: ['Only one.'] })), 'description')[0]).toBe('Only one.');
	});

	it('leaves no raw markup in any element content', () => {
		const feed = buildRssFeed(group({ desc: HTML_DESC }));

		for (const tag of ['title', 'link', 'guid', 'description']) {
			for (const content of contentsOf(feed, tag)) {
				expect(content, `<${tag}> must not contain raw markup`).not.toMatch(/[<>]/);
			}
		}
	});

	it('escapes characters coming from file names', () => {
		const feed = buildRssFeed(group({ olderFiles: [fileRef('x', { url: '/a&b.versatiles' })] }));

		expect(feed).toContain('/a&amp;b.versatiles');
		expect(feed).not.toContain('/a&b.versatiles');
	});

	it('balances every tag it opens', () => {
		const feed = buildRssFeed(group({ desc: HTML_DESC }));
		const stack: string[] = [];

		for (const [, slash, name] of feed.matchAll(/<(\/?)([a-z]+)[^>]*>/g)) {
			if (slash) expect(stack.pop()).toBe(name);
			else stack.push(name!);
		}

		expect(stack).toEqual([]);
	});
});
