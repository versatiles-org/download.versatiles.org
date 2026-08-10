/**
 * How the dialog and the file rows adapt to the viewport.
 *
 * Two breakpoints matter, and each is asserted from both sides rather than only
 * where it applies:
 *
 * - 44rem (704px), where the dialog stops being a centred box and becomes a
 *   full-bleed sheet, because a box that merely fits leaves the map and the
 *   controls fighting over what little height a phone has.
 * - 500px, where a file row breaks out to the full screen width and drops its
 *   two checksum links.
 */
import { test, expect, openDialog, expectInViewport, rowFor, option, hasWebGL2 } from './fixtures.js';
import type { Page } from '@playwright/test';

const FILE = 'osm.versatiles';

/** The dialog's sheet breakpoint, in px at the default root font size. */
const SHEET_BELOW = 704;

/** The row's full-bleed breakpoint. */
const NARROW_ROW_BELOW = 500;

const width = (page: Page) => page.viewportSize()!.width;

test.beforeEach(async ({ page }) => {
	await page.goto('/');
});

test('presents the dialog as a full-bleed sheet on a phone', async ({ page }) => {
	test.skip(width(page) > SHEET_BELOW, 'viewport is wide enough for the centred box');

	const dialog = await openDialog(page, FILE);
	const box = (await dialog.boundingBox())!;
	const viewport = page.viewportSize()!;

	expect(box.x).toBe(0);
	expect(box.width).toBe(viewport.width);
	expect(box.height).toBeCloseTo(viewport.height, 0);

	// A sheet with rounded corners and a border reads as a box that failed to fit.
	const { radius, border } = await dialog.evaluate((element) => ({
		radius: getComputedStyle(element).borderTopLeftRadius,
		border: getComputedStyle(element).borderTopWidth,
	}));
	expect(radius).toBe('0px');
	expect(border).toBe('0px');
});

test('keeps the dialog a centred box on a wide screen', async ({ page }) => {
	test.skip(width(page) <= SHEET_BELOW, 'viewport is in sheet territory');

	const dialog = await openDialog(page, FILE);
	const box = (await dialog.boundingBox())!;
	const viewport = page.viewportSize()!;

	// Centred, with the backdrop visible around it — that is what marks the page
	// behind as out of reach.
	expect(box.x).toBeGreaterThan(0);
	expect(box.width).toBeLessThanOrEqual(viewport.width * 0.9 + 1);
	expect(Math.abs(box.x - (viewport.width - box.width) / 2)).toBeLessThanOrEqual(1);
});

test('stacks the controls in one column on a phone', async ({ page }) => {
	test.skip(width(page) > SHEET_BELOW, 'viewport is wide enough for two columns');

	const dialog = await openDialog(page, FILE);

	const columns = await dialog.locator('.controls').evaluate((el) => getComputedStyle(el).gridTemplateColumns);
	expect(columns.split(/\s+/)).toHaveLength(1);
});

test('keeps the command and the copy button reachable', async ({ page }) => {
	const dialog = await openDialog(page, FILE);
	const resultBar = dialog.locator('.result-bar');

	// The result bar is pinned below a scrolling body; the whole point is that it
	// never needs scrolling to.
	await expect(resultBar).toBeVisible();
	await expectInViewport(page, resultBar);
	await expect(resultBar.getByRole('button', { name: 'Copy' })).toBeVisible();
});

test('keeps the result bar reachable on a landscape phone', async ({ page }) => {
	await page.setViewportSize({ width: 740, height: 380 });

	const dialog = await openDialog(page, FILE);

	await expectInViewport(page, dialog);
	await expectInViewport(page, dialog.locator('.result-bar'));
	await expect(dialog.locator('.result-bar').getByRole('button', { name: 'Copy' })).toBeVisible();
});

test('fits the map and the command on screen together', async ({ page }) => {
	test.skip(!(await hasWebGL2(page)), 'no WebGL2, so maplibre cannot start');

	const dialog = await openDialog(page, FILE);
	await option(dialog, 'area', 'bbox').click();
	await expect(dialog.locator('.bbox-map canvas')).toBeVisible();

	// The reason the sheet exists: on a phone a centred box leaves the map
	// swallowing the drag gestures meant for the scroll area next to it.
	await expectInViewport(page, dialog.locator('.bbox-map'));
	await expectInViewport(page, dialog.locator('.result-bar'));
});

test('never scrolls the page sideways while the dialog is open', async ({ page }) => {
	await openDialog(page, FILE);

	const overflow = await page.evaluate(() => {
		const root = document.scrollingElement!;
		return root.scrollWidth - root.clientWidth;
	});

	expect(overflow).toBeLessThanOrEqual(0);
});

test('drops the checksum links from a narrow row', async ({ page }) => {
	const row = rowFor(page, FILE);
	const narrow = width(page) <= NARROW_ROW_BELOW;

	// The filename, the size and the convert button survive at every width; md5
	// and sha256 are the two that give way.
	await expect(row.getByRole('link', { name: FILE, exact: true })).toBeVisible();
	await expect(row.getByRole('link', { name: '58.1 GB' })).toBeVisible();
	await expect(row.getByTitle('Convert to other format')).toBeVisible();

	const checksums = row.locator('a[href$=".md5"], a[href$=".sha256"]');
	if (narrow) {
		await expect(checksums.first()).toBeHidden();
	} else {
		await expect(checksums.first()).toBeVisible();
		await expect(checksums).toHaveCount(2);
	}
});
