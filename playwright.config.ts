import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests for the download page.
 *
 * These exist because nothing else in the repo runs the UI: vitest is configured
 * with `environment: 'node'`, so the only check that ever looked at the rendered
 * site was `src/build_output.test.ts`, and it greps the built HTML with regexes.
 * A dialog that opens as an empty sliver in one engine passes every one of those.
 *
 * Run against the *built* site rather than `vite dev`: the CSS the browser gets
 * in production has been through lightningcss, which rewrites and drops
 * declarations, and `ConvertHelper.svelte` depends on what survives that.
 */
const PORT = 4173;

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.spec.ts',

	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	// `open: 'never'` so a failing CI run uploads the report instead of trying to
	// serve it and hanging the job.
	reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : [['list']],

	webServer: {
		command: `npm run build:site && npm run preview:site -- --port ${PORT} --strictPort`,
		url: `http://localhost:${PORT}/`,
		reuseExistingServer: !process.env.CI,
		// The build is a vite build plus a prerender pass; on a cold cache it is
		// comfortably slower than the 60s default.
		timeout: 180_000,
		stdout: 'ignore',
		stderr: 'pipe',
	},

	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',

		/*
		 * Pinned, not cosmetic: the map's place-search pre-fills itself with the
		 * viewer's country, which `@versatiles/svelte` derives from
		 * `Intl.DateTimeFormat().resolvedOptions().timeZone`. Without fixing both,
		 * the map tests read differently on every machine.
		 */
		locale: 'en-GB',
		timezoneId: 'UTC',
	},

	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
		{ name: 'firefox', use: { ...devices['Desktop Firefox'] } },
		{ name: 'webkit', use: { ...devices['Desktop Safari'] } },
		// The dialog turns into a full-bleed sheet below 44rem, which no desktop
		// viewport ever reaches.
		{ name: 'mobile-safari', use: { ...devices['iPhone 15'] } },
		{ name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
	],
});
