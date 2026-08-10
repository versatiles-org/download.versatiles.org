/**
 * The convert dialog: that it opens, that it is actually usable once open, and
 * that every way of closing it works and cleans up after itself.
 *
 * These assertions are about *geometry*, not about the DOM. A `<dialog>` that
 * `showModal()` promoted to the top layer is "present", "attached" and even
 * "open" no matter how the engine sized it — a WebKit-only flex collapse leaves
 * a dialog that passes every structural check and shows nothing at all. So the
 * questions asked here are: is it big enough to hold its content, is it inside
 * the viewport, and can you see the two things you came for — the controls and
 * the command.
 */
import { test, expect, openDialog, commandText, rowFor, expectInViewport } from './fixtures.js';

const FILE = 'osm.versatiles';
const OTHER_FILE = 'satellite.versatiles';

/** Smallest dialog that could plausibly hold the controls and the result bar. */
const MIN_WIDTH = 320;
const MIN_HEIGHT = 200;

test.beforeEach(async ({ page }) => {
	await page.goto('/');
});

test('opens a dialog large enough to use', async ({ page }) => {
	const dialog = await openDialog(page, FILE);

	const box = (await dialog.boundingBox())!;

	expect(box.width, 'dialog is too narrow to show its controls').toBeGreaterThanOrEqual(MIN_WIDTH);
	expect(box.height, 'dialog collapsed to less than its content').toBeGreaterThanOrEqual(MIN_HEIGHT);

	// Tighter than the fixed floor above, and the shape that actually breaks: the
	// dialog's height is auto, so an engine that sizes it from the flex base size
	// rather than the content collapses it onto its own borders while the header
	// and the result bar still report their full height.
	const header = (await dialog.locator('.dialog-header').boundingBox())!;
	const resultBar = (await dialog.locator('.result-bar').boundingBox())!;
	expect(box.height, 'dialog is shorter than the content it contains').toBeGreaterThanOrEqual(
		header.height + resultBar.height,
	);

	// A dialog hanging off the edge is as unusable as a collapsed one, and the
	// page's `overflow-x: hidden` would clip it rather than let you scroll to it.
	await expectInViewport(page, dialog);
});

test('shows its header, controls and command', async ({ page }) => {
	const dialog = await openDialog(page, FILE);

	await expect(dialog.locator('.dialog-header')).toBeVisible();
	await expectInViewport(page, dialog.locator('.dialog-header'));
	await expect(dialog.getByText('Select a format:')).toBeVisible();

	// The result bar is the whole point of the dialog and it is pinned below a
	// scrolling body — the layout most likely to push it out of reach.
	const resultBar = dialog.locator('.result-bar');
	await expect(resultBar).toBeVisible();
	await expectInViewport(page, resultBar);
	await expect(resultBar.getByRole('button', { name: 'Copy' })).toBeVisible();

	expect(await commandText(dialog)).toContain('versatiles convert');
});

test('closes with the close button', async ({ page }) => {
	const dialog = await openDialog(page, FILE);

	await dialog.locator('.close-btn').click();

	await expect(dialog).toBeHidden();
});

test('closes with Escape', async ({ page }) => {
	const dialog = await openDialog(page, FILE);

	await page.keyboard.press('Escape');

	await expect(dialog).toBeHidden();
});

test('closes on a click outside it', async ({ page }) => {
	const dialog = await openDialog(page, FILE);

	const box = (await dialog.boundingBox())!;
	test.skip(box.x <= 0 && box.y <= 0, 'full-bleed sheet: there is no backdrop to click');

	await page.mouse.click(2, 2);

	await expect(dialog).toBeHidden();
});

test('stays open when a drag ends outside it', async ({ page }) => {
	const dialog = await openDialog(page, FILE);

	const box = (await dialog.boundingBox())!;
	test.skip(box.x <= 0 && box.y <= 0, 'full-bleed sheet: a drag cannot leave the dialog');

	// Dragging a zoom thumb or a box on the map regularly ends with the pointer
	// past the dialog's edge. The resulting `click` is dispatched on the nearest
	// common ancestor — the dialog itself — so a naive backdrop check reads it as
	// a click on the backdrop and throws the user's work away mid-gesture.
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(2, 2, { steps: 10 });
	await page.mouse.up();

	await expect(dialog).toBeVisible();
});

test('restores page scrolling however it is closed', async ({ page }) => {
	const overflow = () => page.evaluate(() => document.body.style.overflow);

	for (const close of [
		async () => page.locator('dialog[open] .close-btn').click(),
		async () => page.keyboard.press('Escape'),
	]) {
		const dialog = await openDialog(page, FILE);
		expect(await overflow()).toBe('hidden');

		await close();
		await expect(dialog).toBeHidden();

		// Esc closes the dialog without going through the close button, so the
		// lock has to be released from the `close` event rather than the handler.
		// Polled rather than read once: the handler runs on that event, which can
		// land after the dialog has already stopped being visible.
		await expect.poll(overflow, { message: 'page scrolling was never restored' }).toBe('');
	}
});

test('keeps each file’s dialog independent', async ({ page }) => {
	const first = await openDialog(page, FILE);
	await first.getByText('.pmtiles').click();
	expect(await commandText(first)).toContain('osm.pmtiles');
	await first.locator('.close-btn').click();
	await expect(first).toBeHidden();

	// Every row renders its own dialog, so the radio groups have to be namespaced
	// per instance — otherwise choosing a format in one silently clears it in all
	// the others.
	const second = await openDialog(page, OTHER_FILE);
	expect(await commandText(second)).toContain('satellite.versatiles');
	await expect(second.locator('label').filter({ hasText: '.versatiles' }).first()).toHaveClass(/active/);
});

test('opens the dialog belonging to the row that was clicked', async ({ page }) => {
	await rowFor(page, OTHER_FILE).getByTitle('Convert to other format').click();

	await expect(page.locator('dialog[open]')).toHaveCount(1);
	expect(await commandText(page.locator('dialog[open]'))).toContain('/satellite.versatiles');
});
