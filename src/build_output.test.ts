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

	it('gives every dialog its own radio groups', () => {
		const dialogs = (html.match(/<dialog[^>]*>/g) ?? []).length;
		const radios = (html.match(/<input[^>]*>/g) ?? []).filter((tag) => tag.includes('type="radio"'));
		const groups = new Set(radios.map((tag) => /name="([^"]+)"/.exec(tag)?.[1]));

		// Radio groups key off `name`; a shared name would make choosing a format
		// in one dialog silently clear it in all the others.
		expect(groups.size).toBe(dialogs * 2); // one format group + one tool group
	});

	it('preselects exactly one option in each group', () => {
		const checked = html.match(/<input[^>]*type="radio"[^>]*checked[^>]*>/g) ?? [];
		const dialogs = (html.match(/<dialog[^>]*>/g) ?? []).length;

		expect(checked.length).toBe(dialogs * 2);
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
