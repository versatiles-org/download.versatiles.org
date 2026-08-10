import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

/**
 * Assertions about the *built* site rather than about a module.
 *
 * These cover the failures that every other check in this repo is blind to:
 * a dialog that renders open, a radio group shared between dialogs, a heavy
 * dependency that stops being lazy. All of them typecheck, lint and pass the
 * unit tests while being completely broken on screen.
 */
const BUILD_DIR = 'build';
const INDEX = join(BUILD_DIR, 'index.html');

let html: string;

beforeAll(() => {
	// The build is a couple of seconds, and running it here keeps the assertions
	// independent of whether CI happens to build before or after the tests.
	if (!existsSync(INDEX)) execSync('npm run build:site', { stdio: 'ignore' });
	html = readFileSync(INDEX, 'utf-8');
}, 180_000);

/** Every `_app` asset the page loads up front. */
function eagerAssets(extension: 'js' | 'css'): string[] {
	const pattern = new RegExp(`_app/immutable/[a-z]+/[A-Za-z0-9_.-]+\\.${extension}`, 'g');
	return [...new Set(html.match(pattern) ?? [])];
}

/** The markup of each dialog, split apart so groups can be compared per dialog. */
function dialogChunks(): string[] {
	return html.split('<dialog').slice(1);
}

/** Radio `name` values inside one dialog's markup. */
function radioNames(chunk: string): string[] {
	return (chunk.match(/<input[^>]*>/g) ?? [])
		.filter((tag) => tag.includes('type="radio"'))
		.map((tag) => /name="([^"]+)"/.exec(tag)?.[1] ?? '');
}

/** Stylesheets that exist in the build but are not linked from the page. */
function lazyStylesheets(): string[] {
	const eager = new Set(eagerAssets('css'));
	return readdirSync(join(BUILD_DIR, '_app/immutable/assets'))
		.filter((name) => name.endsWith('.css'))
		.map((name) => join('_app/immutable/assets', name))
		.filter((asset) => !eager.has(asset));
}

describe('prerendered markup', () => {
	it('renders a dialog per file group without opening any of them', () => {
		const dialogs = html.match(/<dialog[^>]*>/g) ?? [];

		expect(dialogs.length).toBeGreaterThan(0);
		// `display` on a bare `dialog` selector overrides the UA's `display: none`
		// and reveals every dialog at once, which no other check notices.
		expect(dialogs.filter((tag) => /\bopen\b/.test(tag))).toEqual([]);
	});

	it('never shares a radio group between two dialogs', () => {
		const seen = new Set<string>();

		for (const chunk of dialogChunks()) {
			for (const name of new Set(radioNames(chunk))) {
				// Radio groups key off `name`; a shared name would make choosing a
				// format in one dialog silently clear it in all the others.
				expect(seen.has(name), `radio group "${name}" is reused across dialogs`).toBe(false);
				seen.add(name);
			}
		}

		expect(seen.size).toBeGreaterThan(0);
	});

	it('preselects exactly one option in every group', () => {
		for (const chunk of dialogChunks()) {
			const radios = (chunk.match(/<input[^>]*>/g) ?? []).filter((tag) => tag.includes('type="radio"'));

			for (const name of new Set(radioNames(chunk))) {
				const checked = radios.filter((tag) => tag.includes(`name="${name}"`) && /\bchecked\b/.test(tag));
				expect(checked, `group "${name}" must preselect exactly one option`).toHaveLength(1);
			}
		}
	});
});

describe('dialog visibility', () => {
	/** Every `selector { body }` pair in the built stylesheets, @media unwrapped. */
	function cssRules(): { selector: string; body: string }[] {
		return eagerAssets('css')
			.concat(lazyStylesheets())
			.flatMap((asset) => [...readFileSync(join(BUILD_DIR, asset), 'utf-8').matchAll(/([^{}@]+)\{([^{}]*)\}/g)])
			.map((match) => ({ selector: match[1]!.trim(), body: match[2]! }));
	}

	it('sizes the dialog’s growing children from their content', () => {
		const growing = cssRules().filter((rule) => /\.dialog-(content|body)\b/.test(rule.selector));

		expect(growing.length).toBeGreaterThan(0);

		for (const rule of growing) {
			if (!/flex\s*:/.test(rule.body)) continue;

			// `flex: 1` means `flex-basis: 0`. The dialog's height is auto, and
			// WebKit sizes an auto-height flex container from the flex base size
			// rather than from the content — so a `0` basis collapses the whole
			// dialog onto its borders and Safari renders a 1px line. The browser
			// tests cannot catch this: the WebKit build they drive gets it right.
			//
			// Both spellings are accepted because they are the same value, and
			// lightningcss rewrites the longer one: `flex: auto` *is* `1 1 auto`.
			expect(rule.body, `"${rule.selector}" must set an explicit auto flex-basis`).toMatch(
				/flex\s*:\s*(auto|1 1 auto)\s*[;}]/,
			);
		}
	});

	it('never declares `display` on a dialog selector that is not [open]', () => {
		const offenders = cssRules()
			.filter((rule) => /display\s*:/.test(rule.body))
			.flatMap((rule) => rule.selector.split(','))
			.map((selector) => selector.trim())
			.filter((selector) => /(^|[\s>+~])dialog\b/.test(selector))
			.filter((selector) => !selector.includes('[open]') && !selector.includes('::'));

		// A closed <dialog> is hidden only by the UA stylesheet's `display: none`.
		// Setting `display` on the bare element defeats that and renders every
		// dialog on the page at once — which the markup assertions cannot see,
		// because the `open` attribute is never involved.
		expect(offenders).toEqual([]);
	});
});

describe('initial payload', () => {
	it('keeps the map library out of the first load', () => {
		const total = eagerAssets('js').reduce(
			(sum, asset) => sum + gzipSync(readFileSync(join(BUILD_DIR, asset))).length,
			0,
		);

		// Currently ~47 KB. The budget is deliberately loose: its job is to fail
		// loudly if `@versatiles/svelte` stops being dynamically imported, and
		// maplibre alone is ~250 KB gzip — not to police small changes.
		expect(total).toBeLessThan(60 * 1024);
	});

	it('does not link the map stylesheet up front', () => {
		const css = eagerAssets('css').map((asset) => readFileSync(join(BUILD_DIR, asset), 'utf-8'));

		expect(css.some((sheet) => sheet.includes('maplibregl'))).toBe(false);
	});
});

describe('prerendered routes', () => {
	it('emits an RSS feed for every group that has one', () => {
		const feeds = html.match(/feed-[a-z-]+\.xml/g) ?? [];

		for (const feed of new Set(feeds)) {
			expect(existsSync(join(BUILD_DIR, feed))).toBe(true);
		}
	});
});
