import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
	{
		// The browser tests are `*.spec.ts`, so unlike the unit tests they are
		// linted — they are the only place a stray `test.only` can hide.
		files: ['src/**/*.ts', 'e2e/**/*.ts'],
		ignores: ['**/*.test.ts'],
		languageOptions: {
			parser: tsparser,
			parserOptions: {
				project: './tsconfig.json',
			},
		},
		plugins: {
			'@typescript-eslint': tseslint,
		},
		rules: {
			...tseslint.configs.recommended.rules,
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
			'@typescript-eslint/explicit-function-return-type': 'off',
		},
	},
];
