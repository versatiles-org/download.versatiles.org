/**
 * The dual-thumb zoom range.
 *
 * Driven with the keyboard rather than by dragging: both thumbs sit on one
 * shared track, so a drag test would really be testing where the thumbs happen
 * to be painted. Arrow keys move a known input by a known step, which is what
 * the assertions are about.
 */
import { test, expect, openDialog, commandText, waitForSizeIndex, type TestOptions } from './fixtures.js';
import type { Locator, Page } from '@playwright/test';
import { FIXTURE_ZOOM_CEILING, DEFAULT_MAX_ZOOM } from './fixtures.js';

const FILE = 'osm.versatiles';

function lowest(dialog: Locator): Locator {
	return dialog.getByLabel('Lowest zoom level');
}

function highest(dialog: Locator): Locator {
	return dialog.getByLabel('Highest zoom level');
}

/** Steps a range input with the keyboard; the inputs ignore pointer events. */
async function step(page: Page, input: Locator, key: 'ArrowLeft' | 'ArrowRight', times: number): Promise<void> {
	await input.focus();
	for (let i = 0; i < times; i++) await page.keyboard.press(key);
}

test.beforeEach(async ({ page }) => {
	await page.goto('/');
});

test('takes its ceiling from the container, not the placeholder', async ({ page }) => {
	const dialog = await openDialog(page, FILE);
	await waitForSizeIndex(dialog);

	// Before the index arrives the dialog guesses 14; afterwards it must show
	// what the container actually holds.
	expect(DEFAULT_MAX_ZOOM).not.toBe(FIXTURE_ZOOM_CEILING);
	await expect(dialog.locator('.zoom-value')).toHaveText(`0 – ${FIXTURE_ZOOM_CEILING}`);
	await expect(highest(dialog)).toHaveAttribute('max', String(FIXTURE_ZOOM_CEILING));
	await expect(dialog.locator('.range-scale span')).toHaveText(['0', String(FIXTURE_ZOOM_CEILING)]);
});

test('adds no zoom flags while the whole range is selected', async ({ page }) => {
	const dialog = await openDialog(page, FILE);
	await waitForSizeIndex(dialog);

	const command = await commandText(dialog);
	expect(command).not.toContain('--min-zoom');
	expect(command).not.toContain('--max-zoom');
});

test('adds --min-zoom once the lower bound moves', async ({ page }) => {
	const dialog = await openDialog(page, FILE);
	await waitForSizeIndex(dialog);

	await step(page, lowest(dialog), 'ArrowRight', 2);

	await expect(dialog.locator('.zoom-value')).toHaveText(`2 – ${FIXTURE_ZOOM_CEILING}`);
	const command = await commandText(dialog);
	expect(command).toContain('--min-zoom 2');
	// Still at the ceiling, so capping the top would be a no-op flag.
	expect(command).not.toContain('--max-zoom');
});

test('adds --max-zoom once the upper bound moves', async ({ page }) => {
	const dialog = await openDialog(page, FILE);
	await waitForSizeIndex(dialog);

	await step(page, highest(dialog), 'ArrowLeft', 2);

	await expect(dialog.locator('.zoom-value')).toHaveText(`0 – ${FIXTURE_ZOOM_CEILING - 2}`);
	const command = await commandText(dialog);
	expect(command).toContain(`--max-zoom ${FIXTURE_ZOOM_CEILING - 2}`);
	expect(command).not.toContain('--min-zoom');
});

test('pushes the upper thumb rather than inverting the range', async ({ page }) => {
	const dialog = await openDialog(page, FILE);
	await waitForSizeIndex(dialog);

	await step(page, highest(dialog), 'ArrowLeft', 4); // ceiling 6 → 2
	await expect(dialog.locator('.zoom-value')).toHaveText('0 – 2');

	await step(page, lowest(dialog), 'ArrowRight', 4); // 0 → 4, past the upper thumb

	await expect(dialog.locator('.zoom-value')).toHaveText('4 – 4');
	expect(await commandText(dialog)).toContain('--min-zoom 4');
	expect(await commandText(dialog)).toContain('--max-zoom 4');
});

test('pushes the lower thumb rather than inverting the range', async ({ page }) => {
	const dialog = await openDialog(page, FILE);
	await waitForSizeIndex(dialog);

	await step(page, lowest(dialog), 'ArrowRight', 4); // 0 → 4
	await expect(dialog.locator('.zoom-value')).toHaveText(`4 – ${FIXTURE_ZOOM_CEILING}`);

	await step(page, highest(dialog), 'ArrowLeft', 4); // 6 → 2, past the lower thumb

	await expect(dialog.locator('.zoom-value')).toHaveText('2 – 2');
});

test('never lets a thumb leave the track', async ({ page }) => {
	const dialog = await openDialog(page, FILE);
	await waitForSizeIndex(dialog);

	await step(page, lowest(dialog), 'ArrowLeft', 3);
	await expect(lowest(dialog)).toHaveValue('0');

	await step(page, highest(dialog), 'ArrowRight', 3);
	await expect(highest(dialog)).toHaveValue(String(FIXTURE_ZOOM_CEILING));
});

test.describe('without a size index', () => {
	// A dataset whose index has not been built yet still has to offer a usable
	// zoom range, falling back to the placeholder ceiling.
	test.use({ sizeIndex: null } satisfies Partial<TestOptions>);

	test('falls back to the placeholder ceiling', async ({ page }) => {
		const dialog = await openDialog(page, FILE);

		await expect(dialog.locator('.zoom-value')).toHaveText(`0 – ${DEFAULT_MAX_ZOOM}`);
		await expect(highest(dialog)).toHaveAttribute('max', String(DEFAULT_MAX_ZOOM));
		expect(await commandText(dialog)).not.toContain('--max-zoom');
	});
});
