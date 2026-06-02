import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: undefined,
			precompress: false,
			strict: true,
		}),
		prerender: {
			entries: ['*'],
			// Data files (.versatiles, .md5, .tsv, …) are served straight from R2 and
			// have no SvelteKit route; their <a> tags use rel="external" so the
			// prerender crawler skips them. Don't fail the build if one slips through.
			handleHttpError: () => {},
		},
	},
};

export default config;
