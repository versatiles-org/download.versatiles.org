/**
 * Shared setup for the browser tests.
 *
 * Two things every spec needs and none should repeat: the page has to be cut off
 * from the network, and the clipboard has to be observable.
 *
 * The network part is not optional. The dialog fetches its size index from the
 * *absolute* production url (`estimate.ts:loadSizeIndex`), the map pulls style,
 * glyphs and tiles from `tiles.versatiles.org`, and the page loads its logo from
 * `versatiles.org` — so an unmocked run hits three live services, and the size
 * estimates it asserts on would change whenever the published data changes.
 */
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const SIZE_INDEX = readFileSync(new URL('./fixtures/size-index.json', import.meta.url), 'utf-8');

/** Total bytes of the fixture index, all levels, whole planet. See the fixture's comment. */
export const FIXTURE_FULL_SIZE = 5_592_064;

/** Highest zoom level in the fixture index. */
export const FIXTURE_ZOOM_CEILING = 6;

/** The component's fallback ceiling, used before an index is known (`ConvertHelper.svelte`). */
export const DEFAULT_MAX_ZOOM = 14;

/** A 1x1 transparent PNG, for the favicons. */
const BLANK_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64',
);

/** Stand-in for the VersaTiles logo, with an aspect ratio so the header keeps its height. */
const BLANK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"></svg>';

export type TestOptions = {
	/**
	 * What `*.index.json` responds with. `null` serves a 404, which is how a
	 * dataset with no published index behaves — the dialog has to stay usable.
	 */
	sizeIndex: string | null;
	/**
	 * Fail the test on an uncaught exception in the page. Worth keeping on: a
	 * `TypeError` in a click handler leaves the UI silently inert, which is
	 * exactly the failure mode these tests exist to catch.
	 */
	failOnPageError: boolean;
};

export const test = base.extend<TestOptions>({
	sizeIndex: [SIZE_INDEX, { option: true }],
	failOnPageError: [true, { option: true }],

	page: async ({ page, sizeIndex, failOnPageError }, use) => {
		const errors: Error[] = [];
		page.on('pageerror', (error) => errors.push(error));

		// Firefox and WebKit cannot be granted clipboard permissions the way
		// Chromium can, so the only portable way to see what was copied is to
		// stand in for the API itself.
		await page.addInitScript(() => {
			const written: string[] = [];
			Object.defineProperty(window, '__clipboard', { value: written });
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: {
					writeText: (text: string) => {
						written.push(text);
						return Promise.resolve();
					},
				},
			});
		});

		await page.route('**/*.index.json', (route) =>
			sizeIndex === null
				? route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' })
				: route.fulfill({
						// The index lives on another origin than the page under test, so
						// without this header the fetch fails CORS and the dialog silently
						// falls back to "no index".
						headers: { 'access-control-allow-origin': '*' },
						contentType: 'application/json',
						body: sizeIndex,
					}),
		);

		// Let maplibre initialise — which is all the map tests need — but never
		// wait on a real tile.
		await page.route('https://tiles.versatiles.org/**', (route) => route.abort());

		await page.route('https://versatiles.org/**', (route) =>
			route.request().url().endsWith('.svg')
				? route.fulfill({ contentType: 'image/svg+xml', body: BLANK_SVG })
				: route.fulfill({ contentType: 'image/png', body: BLANK_PNG }),
		);

		await use(page);

		if (failOnPageError && errors.length > 0) {
			throw new Error(`uncaught page error: ${errors.map((error) => error.stack ?? error.message).join('\n')}`);
		}
	},
});

export { expect };

/** The page row for a data file, identified by its filename link. */
export function rowFor(page: Page, filename: string): Locator {
	return page.locator('.row').filter({ has: page.getByRole('link', { name: filename, exact: true }) });
}

/** Opens a file's convert dialog and returns it. */
export async function openDialog(page: Page, filename: string): Promise<Locator> {
	const row = rowFor(page, filename);
	await row.getByTitle('Convert to other format').click();

	const dialog = row.locator('dialog');
	await expect(dialog).toBeVisible();
	return dialog;
}

/** The command the dialog currently shows, exactly as it would be copied. */
export async function commandText(dialog: Locator): Promise<string> {
	return (await dialog.locator('.result-bar pre code').textContent()) ?? '';
}

/**
 * Asserts that an element lies completely inside the viewport.
 *
 * Preferred over `toBeInViewport({ ratio: 1 })`, which is derived from an
 * IntersectionObserver ratio: an element sitting flush against the bottom edge
 * reports something like 0.997 purely from sub-pixel rounding, and the engines
 * round the same layout to different sides of the pixel. A one-pixel tolerance
 * over the real geometry says what is actually meant.
 */
export async function expectInViewport(page: Page, locator: Locator, tolerance = 1): Promise<void> {
	const box = await locator.boundingBox();
	expect(box, 'element has no box, so it cannot be in the viewport').not.toBeNull();

	const viewport = page.viewportSize()!;
	expect(box!.x).toBeGreaterThanOrEqual(-tolerance);
	expect(box!.y).toBeGreaterThanOrEqual(-tolerance);
	expect(box!.x + box!.width, 'element runs past the right edge').toBeLessThanOrEqual(viewport.width + tolerance);
	expect(box!.y + box!.height, 'element runs past the bottom edge').toBeLessThanOrEqual(viewport.height + tolerance);
}

/** What the page has written to the clipboard so far. */
export function clipboardHistory(page: Page): Promise<string[]> {
	return page.evaluate(() => (window as unknown as { __clipboard: string[] }).__clipboard);
}

/**
 * Whether the browser can actually create a WebGL2 context.
 *
 * maplibre's `Map` constructor throws without one, and headless WebKit and
 * Firefox on Linux frequently have none — so the map specs ask rather than
 * hard-coding which browsers are expected to work.
 */
export function hasWebGL2(page: Page): Promise<boolean> {
	return page.evaluate(() => {
		try {
			return !!document.createElement('canvas').getContext('webgl2');
		} catch {
			return false;
		}
	});
}
