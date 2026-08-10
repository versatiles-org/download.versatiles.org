/**
 * The format and tool selectors.
 *
 * Every control in the dialog exists to change one string — the command in the
 * result bar — so that string is what gets asserted, rather than the internal
 * state that produced it.
 */
import { test, expect, openDialog, commandText, option, waitForSizeIndex } from './fixtures.js';

const FILE = 'osm.versatiles';
const SOURCE = 'https://download.versatiles.org/osm.versatiles';

/** `buildCommand` joins its parts with a trailing backslash and two spaces. */
const JOIN = ' \\\n  ';

test.beforeEach(async ({ page }) => {
	await page.goto('/');
});

test('starts on the plain whole-file command', async ({ page }) => {
	const dialog = await openDialog(page, FILE);
	await waitForSizeIndex(dialog);

	// Nothing has been narrowed, so no flag should appear at all — an untouched
	// dialog is meant to show the simplest command that does the job.
	expect(await commandText(dialog)).toBe(['versatiles convert', `"${SOURCE}"`, `"${FILE}"`].join(JOIN));
});

for (const format of ['versatiles', 'pmtiles', 'mbtiles', 'tar']) {
	test(`writes .${format} as the output format`, async ({ page }) => {
		const dialog = await openDialog(page, FILE);

		await option(dialog, 'format', format).click();

		await expect(option(dialog, 'format', format)).toHaveClass(/active/);
		expect(await commandText(dialog)).toContain(`"osm.${format}"`);
	});
}

test('switches between the binary and the docker invocation', async ({ page }) => {
	const dialog = await openDialog(page, FILE);
	await waitForSizeIndex(dialog);

	await option(dialog, 'tool', 'docker').click();

	// Docker needs the working directory mounted, and the output path has to be
	// the one *inside* that mount.
	expect(await commandText(dialog)).toBe(
		[
			'docker run -it --rm -v $(pwd):/data',
			'versatiles/versatiles:latest convert',
			`"${SOURCE}"`,
			`"/data/${FILE}"`,
		].join(JOIN),
	);

	await option(dialog, 'tool', 'versatiles').click();

	expect(await commandText(dialog)).toBe(['versatiles convert', `"${SOURCE}"`, `"${FILE}"`].join(JOIN));
});

test('carries the format through to the docker output path', async ({ page }) => {
	const dialog = await openDialog(page, FILE);

	await option(dialog, 'tool', 'docker').click();
	await option(dialog, 'format', 'mbtiles').click();

	expect(await commandText(dialog)).toContain('"/data/osm.mbtiles"');
});

test('swaps the install hint with the tool', async ({ page }) => {
	const dialog = await openDialog(page, FILE);

	const link = dialog.locator('.install-link');
	await expect(link).toBeVisible();
	await expect(link).toHaveAttribute('href', 'https://docs.versatiles.org/guides/install_versatiles.html');
	// Opens a third-party site in a new tab, so it must not hand over the opener.
	await expect(link).toHaveAttribute('target', '_blank');
	await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

	await option(dialog, 'tool', 'docker').click();

	await expect(link).toBeHidden();
	await expect(dialog.locator('.install-note')).toHaveText('Nothing to install — docker pulls the image on first run.');
});

test('marks exactly one option per group as active', async ({ page }) => {
	const dialog = await openDialog(page, FILE);

	await option(dialog, 'format', 'tar').click();
	await option(dialog, 'tool', 'docker').click();

	for (const [group, chosen, others] of [
		['format', 'tar', ['versatiles', 'pmtiles', 'mbtiles']],
		['tool', 'docker', ['versatiles']],
		['area', 'planet', ['bbox']],
	] as const) {
		await expect(option(dialog, group, chosen)).toHaveClass(/active/);
		for (const other of others) {
			await expect(option(dialog, group, other)).not.toHaveClass(/active/);
		}
	}
});
