import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	build: {
		/*
		 * Pinned rather than left to Vite's default.
		 *
		 * The default (`baseline-widely-available`) is a moving window: it is fixed
		 * per Vite release, so a Vite upgrade silently changes which browsers the
		 * output supports and which CSS lightningcss downlevels — including whether
		 * fallback declarations survive. That is not something a dependency bump
		 * should decide.
		 *
		 * The floor is derived from what the shipped CSS actually uses, taking the
		 * highest requirement of each: `color-mix()` (Chrome 111, Safari 16.2,
		 * Firefox 113) and `:has()` (Firefox 121). `dvh` (Safari 15.4),
		 * `overscroll-behavior` (Safari 16) and `<dialog>` (Safari 15.4) all sit
		 * below it. Raising any of these means re-checking the built stylesheet.
		 *
		 * `build.cssTarget` defaults to this, so it covers CSS as well as JS.
		 */
		target: ['chrome111', 'edge111', 'firefox121', 'safari16.4'],
	},
	test: {
		globals: true,
		environment: 'node',
		// The worker is a separate package but has no test runner of its own, so its
		// tests run here rather than adding a second vitest install.
		include: ['src/**/*.test.ts', 'worker/src/**/*.test.ts'],
		coverage: {
			include: ['src/**/*.ts', 'worker/src/**/*.ts'],
			exclude: ['**/*.test.ts'],
		},
	},
});
