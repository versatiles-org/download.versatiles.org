/**
 * Keyboard operation of the dialog.
 *
 * The segmented controls are real radio inputs made invisible by CSS, which is
 * what buys arrow-key navigation and a sensible screen-reader announcement for
 * free — but only as long as they stay focusable and their focus ring stays
 * mirrored onto the visible label.
 */
import { test, expect, openDialog, openDialogByKeyboard, commandText } from './fixtures.js';
import type { Page } from '@playwright/test';

const FILE = 'osm.versatiles';

/** Where the focus is, described well enough to assert on. */
function focused(page: Page) {
	return page.evaluate(() => {
		const element = document.activeElement as HTMLElement | null;
		return {
			tag: element?.tagName ?? '',
			inDialog: !!element?.closest('dialog'),
			name: element?.getAttribute('name') ?? '',
			value: (element as HTMLInputElement | null)?.value ?? '',
			title: element?.getAttribute('title') ?? '',
		};
	});
}

test.beforeEach(async ({ page }) => {
	await page.goto('/');
});

test('opens from the keyboard', async ({ page }) => {
	const dialog = await openDialogByKeyboard(page, FILE);

	await expect(dialog).toBeVisible();
	await expect(dialog.locator('.result-bar')).toBeVisible();
});

test('puts focus inside the dialog when it opens', async ({ page }) => {
	await openDialog(page, FILE);

	expect((await focused(page)).inDialog).toBe(true);
});

test('never lets focus reach the page behind the dialog', async ({ page }) => {
	await openDialog(page, FILE);

	/*
	 * The invariant is that the page behind is inert, not that focus never leaves
	 * the dialog's elements: every engine parks focus on `<body>` when the tab
	 * cycle wraps, and WebKit does so almost immediately because macOS Tab only
	 * visits form controls unless Full Keyboard Access is on. What must never
	 * happen is focus landing on something interactive *outside* the dialog.
	 */
	const INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY', 'DETAILS']);
	let everInside = false;

	for (let i = 0; i < 25; i++) {
		await page.keyboard.press('Tab');
		const state = await focused(page);
		everInside ||= state.inDialog;

		expect(
			state.inDialog || !INTERACTIVE.has(state.tag),
			`focus reached <${state.tag.toLowerCase()}> outside the dialog after ${i + 1} tabs`,
		).toBe(true);
	}

	expect(everInside, 'tabbing never reached anything inside the dialog').toBe(true);
});

test('moves between formats with the arrow keys', async ({ page }) => {
	const dialog = await openDialog(page, FILE);

	await dialog.locator('input[name$="-format"][value="versatiles"]').focus();
	await page.keyboard.press('ArrowRight');

	await expect(dialog.locator('input[name$="-format"][value="pmtiles"]')).toBeChecked();
	expect(await commandText(dialog)).toContain('"osm.pmtiles"');

	await page.keyboard.press('ArrowRight');

	await expect(dialog.locator('input[name$="-format"][value="mbtiles"]')).toBeChecked();
	expect(await commandText(dialog)).toContain('"osm.mbtiles"');
});

test('moves between tools with the arrow keys', async ({ page }) => {
	const dialog = await openDialog(page, FILE);

	await dialog.locator('input[name$="-tool"][value="versatiles"]').focus();
	await page.keyboard.press('ArrowRight');

	await expect(dialog.locator('input[name$="-tool"][value="docker"]')).toBeChecked();
	expect(await commandText(dialog)).toContain('docker run');
});

test('keeps the visually hidden options focusable', async ({ page }) => {
	const dialog = await openDialog(page, FILE);

	/*
	 * The segmented controls are real radios shrunk to 1px and made transparent,
	 * which is what buys arrow-key navigation and a correct screen-reader
	 * announcement. That only holds while they stay focusable — `display: none`,
	 * `visibility: hidden` or a stray `tabindex="-1"` would each keep the control
	 * looking identical while removing it from the keyboard entirely.
	 *
	 * Asserted via focus rather than via Tab on purpose: whether Tab *visits* a
	 * radio is a platform setting (macOS only tabs to form fields unless Full
	 * Keyboard Access is on), so tabbing would test the browser's configuration
	 * rather than this markup.
	 */
	for (const group of ['area', 'format', 'tool']) {
		const input = dialog.locator(`input[name$="-${group}"]`).first();
		await input.focus();

		expect(await focused(page), `the ${group} options cannot take focus`).toMatchObject({
			tag: 'INPUT',
			inDialog: true,
		});
	}
});

test('gives the zoom sliders accessible names', async ({ page }) => {
	const dialog = await openDialog(page, FILE);

	// The thumbs carry no visible text of their own, so without these the two are
	// indistinguishable to anyone not looking at the track.
	await expect(dialog.getByLabel('Lowest zoom level')).toBeVisible();
	await expect(dialog.getByLabel('Highest zoom level')).toBeVisible();
});

test('shows the focus ring on the option that has focus', async ({ page }) => {
	const dialog = await openDialog(page, FILE);

	/*
	 * Focus is moved with an arrow key rather than by tabbing to it: the ring is
	 * `:focus-visible`, which deliberately ignores programmatic focus, and Tab
	 * cannot be used to reach a radio in WebKit unless macOS Full Keyboard Access
	 * is on. Arrow-key navigation within the group is keyboard interaction
	 * everywhere.
	 */
	await dialog.locator('input[name$="-format"][value="versatiles"]').focus();
	await page.keyboard.press('ArrowRight');

	const state = await focused(page);
	expect(state.name.endsWith('-format') && state.value === 'pmtiles').toBe(true);

	/*
	 * Asserted on the computed outline rather than on the selector behind it: the
	 * requirement is that a keyboard user can see where they are, and the two
	 * engines disagree about which selector delivers that. WebKit matches
	 * `:focus` but never `:focus-visible` on a radio, so a test written against
	 * `:focus-visible` would pass while Safari showed no ring at all.
	 */
	const label = dialog.locator('label:has(input[name$="-format"][value="pmtiles"])');
	const outline = await label.evaluate((element) => {
		const style = getComputedStyle(element);
		return { style: style.outlineStyle, width: style.outlineWidth };
	});

	expect(outline.style, 'the focused option has no visible focus ring').not.toBe('none');
	expect(parseFloat(outline.width)).toBeGreaterThan(0);
});

test('returns focus to the trigger after closing', async ({ page }) => {
	// Opened from the keyboard on purpose. On macOS a click does not focus a
	// button, so a mouse-opened dialog has nothing to hand focus back to — it is
	// the keyboard path where losing the place actually strands someone.
	await openDialogByKeyboard(page, FILE);

	await page.keyboard.press('Escape');

	// Losing the place in the page is the difference between a dialog you can dip
	// into and one you have to recover from.
	expect((await focused(page)).title).toBe('Convert to other format');
});
