/**
 * The area selector and the map behind it.
 *
 * Tagged `@map` and skipped where the browser has no WebGL2: maplibre's `Map`
 * constructor throws without one, and headless WebKit and Firefox on Linux
 * frequently have none. Asked at runtime rather than hard-coded per browser, so
 * the coverage follows the machine.
 *
 * Tile requests are aborted by the fixture, so nothing here waits on a rendered
 * tile — the assertions are about the toolbar, the chosen bounds, and the
 * command they produce.
 */
import { test, expect, openDialog, commandText, option, waitForSizeIndex, hasWebGL2 } from './fixtures.js';
import type { Locator } from '@playwright/test';

const FILE = 'osm.versatiles';

/** Bounds of the viewer's country, which the place search pre-selects. See `playwright.config.ts`. */
const UNITED_KINGDOM = '-13.7,49.9,1.78,60.85';

/** Bounds of the first `Portugal` entry in the bundled place list. */
const PORTUGAL = '-31.29,30.02,-6.2,42.16';

/** The four numbers of the `--bbox` flag, or null when the command has none. */
async function bboxOf(dialog: Locator): Promise<number[] | null> {
	const match = /--bbox (\S+)/.exec(await commandText(dialog));
	return match ? match[1]!.split(',').map(Number) : null;
}

test.describe('map loading', () => {
	test('loads the map library only once an area is asked for', async ({ page }) => {
		const chunks: string[] = [];
		page.on('request', (request) => {
			if (/_app\/immutable\/.*\.js$/.test(request.url())) chunks.push(request.url());
		});

		await page.goto('/');
		const dialog = await openDialog(page, FILE);
		test.skip(!(await hasWebGL2(page)), 'no WebGL2, so maplibre cannot start');

		// Most downloads are of the whole planet and never need a map; maplibre and
		// its basemap style are a large payload to spend on the ones that do not.
		const eager = chunks.length;
		await expect(dialog.locator('.bbox-map')).toHaveCount(0);

		await option(dialog, 'area', 'bbox').click();
		await expect(dialog.locator('.bbox-map canvas')).toBeVisible();

		expect(chunks.length, 'choosing an area should have fetched the map chunk').toBeGreaterThan(eager);
	});
});

test.describe('area selection', { tag: '@map' }, () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		test.skip(!(await hasWebGL2(page)), 'no WebGL2, so maplibre cannot start');
	});

	test('shows the map and its toolbar', async ({ page }) => {
		const dialog = await openDialog(page, FILE);

		await option(dialog, 'area', 'bbox').click();

		await expect(dialog.locator('.bbox-map canvas')).toBeVisible();
		await expect(dialog.locator('.bbox-map input[type="text"]')).toBeVisible();
		await expect(dialog.getByTitle('Use visible area as bounding box')).toBeVisible();
	});

	test('starts from the viewer’s own country', async ({ page }) => {
		const dialog = await openDialog(page, FILE);

		await option(dialog, 'area', 'bbox').click();

		/*
		 * The place search pre-fills itself from the locale and immediately selects
		 * that country, so an area is always chosen before the user touches the map.
		 *
		 * The dialog depends on this: it deliberately shows no "drag a box" hint,
		 * because there is no moment at which the map is up and no area is picked.
		 * If this ever stops holding, that empty state comes back with nothing to
		 * explain it — which is what this assertion is guarding.
		 */
		await expect(dialog.locator('.bbox-map input[type="text"]')).toHaveValue('United Kingdom');
		expect(await commandText(dialog)).toContain(`--bbox ${UNITED_KINGDOM}`);
	});

	test('narrows the estimate to the chosen area', async ({ page }) => {
		const dialog = await openDialog(page, FILE);
		await waitForSizeIndex(dialog);
		const whole = await dialog.locator('.result-size strong').textContent();

		await option(dialog, 'area', 'bbox').click();

		await expect(dialog.locator('.result-size strong')).not.toHaveText(whole!);
		await expect(dialog.getByText('whole dataset')).toBeHidden();
	});

	test('takes its bounds from the place search', async ({ page }) => {
		const dialog = await openDialog(page, FILE);
		await option(dialog, 'area', 'bbox').click();
		await expect(dialog.locator('.bbox-map canvas')).toBeVisible();

		await dialog.locator('.bbox-map input[type="text"]').fill('Portugal');
		await page.keyboard.press('Enter');

		expect(await commandText(dialog)).toContain(`--bbox ${PORTUGAL}`);
	});

	test('takes its bounds from the visible area on request', async ({ page }) => {
		const dialog = await openDialog(page, FILE);
		await option(dialog, 'area', 'bbox').click();
		await expect(dialog.locator('.bbox-map canvas')).toBeVisible();
		const before = await bboxOf(dialog);

		await dialog.getByTitle('Use visible area as bounding box').click();

		// The visible area is the stored bounds plus the map's padding, so it is
		// never exactly what was there before.
		await expect.poll(() => bboxOf(dialog)).not.toEqual(before);
		const after = await bboxOf(dialog);
		expect(after).toHaveLength(4);
		expect(after!.every(Number.isFinite)).toBe(true);
	});

	test('drops the area when the whole planet is chosen again', async ({ page }) => {
		const dialog = await openDialog(page, FILE);
		await waitForSizeIndex(dialog);

		await option(dialog, 'area', 'bbox').click();
		// The bounds only arrive once the map has mounted and the place search has
		// pre-selected a country, so this is polled rather than read straight away.
		await expect.poll(() => commandText(dialog)).toContain('--bbox');

		await option(dialog, 'area', 'planet').click();

		expect(await commandText(dialog)).not.toContain('--bbox');
		await expect(dialog.locator('.bbox-map')).toHaveCount(0);
		await expect(dialog.getByText('whole dataset')).toBeVisible();
	});

	test('stays open when a drag on the map ends outside the dialog', async ({ page }) => {
		const dialog = await openDialog(page, FILE);
		await option(dialog, 'area', 'bbox').click();
		const canvas = dialog.locator('.bbox-map canvas');
		await expect(canvas).toBeVisible();

		const dialogBox = (await dialog.boundingBox())!;
		test.skip(dialogBox.x <= 0 && dialogBox.y <= 0, 'full-bleed sheet: a drag cannot leave the dialog');

		// Drawing a box near the edge of the map regularly ends with the pointer
		// outside the dialog; the resulting click is dispatched on the dialog
		// itself, which used to be indistinguishable from a backdrop click.
		const map = (await canvas.boundingBox())!;
		await page.mouse.move(map.x + map.width / 2, map.y + map.height / 2);
		await page.mouse.down();
		await page.mouse.move(2, 2, { steps: 10 });
		await page.mouse.up();

		await expect(dialog).toBeVisible();
	});

	test('keeps the dialog open when Escape dismisses the place search', async ({ page }) => {
		const dialog = await openDialog(page, FILE);
		await option(dialog, 'area', 'bbox').click();
		const search = dialog.locator('.bbox-map input[type="text"]');
		await expect(search).toBeVisible();

		await search.click();
		await page.keyboard.press('Escape');

		// The place search swallows Escape to close its own dropdown; that must not
		// also dismiss the dialog around it.
		await expect(dialog).toBeVisible();
	});
});
