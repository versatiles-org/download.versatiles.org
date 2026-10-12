/**
 * The landing page itself: what renders, what it links to, and that none of the
 * dialogs are on screen before they are asked for.
 *
 * The counts are hard-coded because the fixture data is: `generate_testdata.ts`
 * always produces the same six groups, with osm the only one carrying older
 * versions.
 */
import { test, expect, rowFor } from './fixtures.js';

const GROUPS = [
	{ slug: 'osm', tileType: 'vector' },
	{ slug: 'satellite', tileType: 'raster' },
	{ slug: 'elevation', tileType: 'raster' },
	{ slug: 'landcover-vectors', tileType: 'vector' },
	{ slug: 'hillshade-vectors', tileType: 'vector' },
	{ slug: 'bathymetry-vectors', tileType: 'vector' },
];

/**
 * The promoted copy of the newest osm file: `groupFiles()` clones the newest
 * entry and strips its date, so the group's headline row is the undated alias
 * while every dated version — including the one it was cloned from — stays in
 * `olderFiles`.
 */
const LATEST_OSM = 'osm.versatiles';

/** Dated osm versions behind the disclosure, the newest one included. */
const OLDER_OSM_COUNT = 9;

/*
 * One test with a step per concern, rather than one test per concern.
 *
 * All of these read the same freshly loaded page, and a test of its own costs a
 * browser context and a page load in each of the five projects — more than the
 * checks themselves take. The steps keep their names in the report, and the
 * checks are soft, so one that fails does not hide the ones after it.
 *
 * Only the last step changes the page (it opens the disclosure); it is last so
 * that everything before it sees the page as a visitor first does.
 */
test('the landing page', async ({ page }) => {
	await page.goto('/');

	await test.step('renders a section for every file group', async () => {
		await expect.soft(page.locator('h2')).toHaveCount(GROUPS.length);

		for (const { slug, tileType } of GROUPS) {
			const heading = page.locator(`h2#${slug}`);
			await expect.soft(heading).toBeVisible();
			await expect.soft(heading.locator('.tile-type')).toHaveText(tileType);
			await expect.soft(heading.locator('a.anchor')).toHaveAttribute('href', `#${slug}`);
		}
	});

	await test.step('links each group to its url list and feed', async () => {
		for (const { slug } of GROUPS) {
			const links = page.locator(`h2#${slug} + .group-desc .group-links`);
			await expect.soft(links.getByRole('link', { name: 'URL list' })).toHaveAttribute('href', `/urllist_${slug}.tsv`);
			await expect.soft(links.getByRole('link', { name: 'RSS' })).toHaveAttribute('href', `/feed-${slug}.xml`);
		}
	});

	await test.step('advertises the feed of every group that has one', async () => {
		// Only groups with older versions get a feed; osm is the only such group in
		// the fixture data.
		await expect.soft(page.locator('link[rel="alternate"][type="application/rss+xml"]')).toHaveCount(1);
		await expect.soft(page.locator('link[rel="alternate"]')).toHaveAttribute('href', '/feed-osm.xml');
	});

	await test.step('shows the latest file of each group with its hashes and size', async () => {
		const row = rowFor(page, LATEST_OSM);

		await expect
			.soft(row.getByRole('link', { name: LATEST_OSM, exact: true }))
			.toHaveAttribute('href', `/${LATEST_OSM}`);
		await expect.soft(row.getByRole('link', { name: '58.1 GB' })).toHaveAttribute('href', `/${LATEST_OSM}`);

		// Located by attribute rather than by role: below 500px the row drops the two
		// checksum links with `display: none`, which takes them out of the
		// accessibility tree. Whether they are *shown* is a responsive question and
		// is asserted there; here it is only that they point at the right files.
		await expect.soft(row.locator('a[href$=".md5"]')).toHaveAttribute('href', `/${LATEST_OSM}.md5`);
		await expect.soft(row.locator('a[href$=".sha256"]')).toHaveAttribute('href', `/${LATEST_OSM}.sha256`);
	});

	await test.step('opens with no dialog on screen', async () => {
		const dialogs = page.locator('dialog');

		// One dialog per file row, all of them closed. A stray `display` rule on the
		// bare `dialog` selector defeats the UA's `display: none` and reveals every
		// one of them at once.
		expect.soft(await dialogs.count()).toBeGreaterThan(0);
		await expect.soft(dialogs.locator(':scope[open]')).toHaveCount(0);

		for (const dialog of await dialogs.all()) {
			await expect.soft(dialog).toBeHidden();
		}
	});

	await test.step('does not scroll horizontally', async () => {
		// `.row` breaks out to `100vw` below 500px and `main` is what clips it; if
		// that ever stops working the whole page gains a horizontal scrollbar.
		const overflow = await page.evaluate(() => {
			const root = document.scrollingElement!;
			return root.scrollWidth - root.clientWidth;
		});

		expect.soft(overflow).toBeLessThanOrEqual(0);
	});

	await test.step('hides older versions behind the disclosure', async () => {
		const details = page.locator('details').first();
		const olderRows = details.locator('.row');

		await expect.soft(details.getByText('Show all versions')).toBeVisible();
		await expect.soft(olderRows.first()).toBeHidden();

		await details.getByText('Show all versions').click();

		await expect.soft(olderRows).toHaveCount(OLDER_OSM_COUNT);
		await expect.soft(olderRows.first()).toBeVisible();
	});
});
