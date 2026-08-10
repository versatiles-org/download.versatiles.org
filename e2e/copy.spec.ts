/**
 * The copy button.
 *
 * `navigator.clipboard` is stubbed for these tests (see `fixtures.ts`) — Firefox
 * and WebKit cannot be granted clipboard permissions the way Chromium can, so
 * standing in for the API is the only portable way to see what was written.
 */
import { test, expect, openDialog, commandText, clipboardHistory, option } from './fixtures.js';

const FILE = 'osm.versatiles';

test.describe('with a clipboard', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
	});

	test('copies exactly the command on screen', async ({ page }) => {
		const dialog = await openDialog(page, FILE);
		const shown = await commandText(dialog);

		await dialog.getByRole('button', { name: 'Copy' }).click();

		// Byte-for-byte: the command is multi-line and backslash-continued, and a
		// copy that loses the line breaks does not run.
		expect(await clipboardHistory(page)).toEqual([shown]);
		expect(shown).toContain('\\\n  ');
	});

	test('confirms the copy and goes back to offering one', async ({ page }) => {
		const dialog = await openDialog(page, FILE);
		const button = dialog.locator('.copy-btn');

		await button.click();

		await expect(button).toHaveText('Copied!');
		await expect(button).toHaveText('Copy', { timeout: 4000 });
	});

	test('copies the command as it stands, not as it started', async ({ page }) => {
		const dialog = await openDialog(page, FILE);

		await dialog.getByRole('button', { name: 'Copy' }).click();
		await option(dialog, 'tool', 'docker').click();
		await option(dialog, 'format', 'pmtiles').click();
		await dialog.locator('.copy-btn').click();

		const history = await clipboardHistory(page);
		expect(history).toHaveLength(2);
		expect(history[1]).toBe(await commandText(dialog));
		expect(history[1]).toContain('"/data/osm.pmtiles"');
	});
});

test.describe('without a clipboard', () => {
	// Safari exposes `navigator.clipboard` only in a secure context, so a preview
	// build opened over plain http on a LAN address has none at all. Installed
	// before the first navigation rather than with a reload: reloading aborts the
	// module preloads that are still in flight, which fails the page-error guard.
	test.beforeEach(async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
		});
		await page.goto('/');
	});

	test('falls back to selecting the command', async ({ page }) => {
		const dialog = await openDialog(page, FILE);
		const button = dialog.locator('.copy-btn');

		await button.click();

		await expect(button).toHaveText('Copy failed');

		// The point of the fallback: the command ends up selected, so the keyboard
		// shortcut still gets the user what they came for.
		const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
		expect(selected).toBe(await commandText(dialog));

		await expect(button).toHaveText('Copy', { timeout: 4000 });
	});
});
