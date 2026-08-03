import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
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
