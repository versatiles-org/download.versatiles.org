/**
 * Builds the RSS feed listing the previous versions of a dataset.
 *
 * Kept out of the route file so it can be tested directly — SvelteKit reserves
 * `+`-prefixed names, so a test could not sit beside `+server.ts` anyway.
 */
import type { FileGroupData } from './data.js';

/** Public origin the feed links to. */
const BASE_URL = 'https://download.versatiles.org';

/**
 * Escapes text for use as XML element content.
 *
 * Group descriptions are HTML — they contain links and `<br>` — so interpolating
 * them raw produced feeds that were not well-formed XML and that readers
 * rejected. Escaped markup inside an RSS `<description>` is the conventional way
 * to carry HTML, and readers render it as such.
 */
export function escapeXml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Renders the RSS 2.0 feed for a group's older versions. */
export function buildRssFeed(group: FileGroupData): string {
	const items = group.olderFiles
		.map(
			(file) =>
				`        <item>
            <title>${escapeXml(file.url)}</title>
            <link>${escapeXml(`${BASE_URL}${file.url}`)}</link>
            <guid>${escapeXml(`${file.filename};${file.hashes.md5}`)}</guid>
            <description>${escapeXml(file.sizeString)}</description>
        </item>`,
		)
		.join('\n');

	return `<rss version="2.0">
    <channel>
        <title>Versatiles data releases: ${escapeXml(group.slug)}</title>
        <link>${BASE_URL}/</link>
        <description>${escapeXml(group.desc.join('\n'))}</description>
${items}
    </channel>
</rss>
`;
}
