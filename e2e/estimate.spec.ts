/**
 * The download size estimate.
 *
 * The numbers here are exact rather than approximate: the fixture index is a
 * uniform 1024 bytes per tile over zoom 0-6, so every figure the dialog shows is
 * arithmetic that can be written down. See `e2e/fixtures/size-index.json`.
 */
import { test, expect, openDialog, waitForSizeIndex, SIZE_INDEX, type TestOptions } from './fixtures.js';

const FILE = 'osm.versatiles';

/** sum(4^z for z in 0..6) * 1024 — the whole fixture container. */
const FULL = '5.33 MB';

/** sum(4^z for z in 0..4) * 1024 — the same container capped at zoom 4. */
const THROUGH_Z4 = '341 KB';

test.beforeEach(async ({ page }) => {
	await page.goto('/');
});

test('estimates the whole dataset once the index arrives', async ({ page }) => {
	const dialog = await openDialog(page, FILE);
	await waitForSizeIndex(dialog);

	await expect(dialog.locator('.result-size strong')).toHaveText(`~ ${FULL}`);
	// The selection still covers everything the container holds, and saying so is
	// what tells the user the estimate is not the result of a mistake.
	await expect(dialog.getByText('whole dataset')).toBeVisible();
});

test('shrinks the estimate as zoom levels are dropped', async ({ page }) => {
	const dialog = await openDialog(page, FILE);
	await waitForSizeIndex(dialog);

	await dialog.getByLabel('Highest zoom level').focus();
	await page.keyboard.press('ArrowLeft');
	await page.keyboard.press('ArrowLeft');

	await expect(dialog.locator('.result-size strong')).toHaveText(`~ ${THROUGH_Z4}`);
	await expect(dialog.getByText('whole dataset')).toBeHidden();
});

test('asks for no estimate before the index has arrived', async ({ page }) => {
	// Served slowly on purpose: the placeholder is only on screen for as long as
	// the request is in flight, which is otherwise too short to observe.
	await page.route('**/*.index.json', async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 1500));
		await route.fulfill({
			headers: { 'access-control-allow-origin': '*' },
			contentType: 'application/json',
			body: SIZE_INDEX,
		});
	});

	const dialog = await openDialog(page, FILE);

	await expect(dialog.getByText('Run this command')).toBeVisible();
	await expect(dialog.locator('.result-size strong')).toBeHidden();

	// …and it gives way to the real figure without any further interaction.
	await expect(dialog.locator('.result-size strong')).toHaveText(`~ ${FULL}`);
	await expect(dialog.getByText('Run this command')).toBeHidden();
});

test.describe('when the dataset has no index', () => {
	test.use({ sizeIndex: null } satisfies Partial<TestOptions>);

	test('keeps the plain label and stays usable', async ({ page }) => {
		const dialog = await openDialog(page, FILE);

		// Older versions are not indexed and a newly added dataset has none until
		// the pipeline has built one, so a missing index is normal, not an error.
		await expect(dialog.getByText('Run this command')).toBeVisible();
		await expect(dialog.getByText('Estimated file size')).toBeHidden();
		await expect(dialog.getByRole('button', { name: 'Copy' })).toBeVisible();
	});
});

test('survives the index request failing outright', async ({ page }) => {
	await page.route('**/*.index.json', (route) => route.abort());

	const dialog = await openDialog(page, FILE);

	await expect(dialog.getByText('Run this command')).toBeVisible();
	await expect(dialog.getByLabel('Highest zoom level')).toBeVisible();
});
