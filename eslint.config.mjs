import node from '@stimulcross/eslint-config-node';
import nodeStyle from '@stimulcross/eslint-config-node/style';
import typescript from '@stimulcross/eslint-config-typescript';
import typescriptStyle from '@stimulcross/eslint-config-typescript/style';

const globs = {
	js: [`src/**/*.js`, `src/**/*.cjs`, `src/**/*.mjs`],
	ts: [`src/**/*.ts`, `src/**/*.cts`, `src/**/*.mts`],
	jsSpec: [`tests/**/*.spec.js`, `tests/**/*.spec.cjs`, `tests/**/*.spec.mjs`],
	tsSpec: [`tests/**/*.spec.ts`, `tests/**/*.spec.cts`, `tests/**/*.spec.mts`],
	ignore: ['**/lib', '**/es', '**/node_modules', '.idea', 'coverage', '**/*.d.ts'],
};

/** @type {import("eslint").Linter.Config[]} */
const config = [
	{
		ignores: [...globs.ignore],
	},
	{
		...node,
		files: [...globs.js, ...globs.ts],
		rules: {
			'no-await-in-loo': 'off',
		},
	},
	{
		...nodeStyle,
		files: [...globs.js, ...globs.ts],
	},
	{
		...typescript,
		files: [...globs.ts],
		rules: {
			camelcase: 'off',
			'new-cap': 'off',
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
		},
	},
	{
		...typescriptStyle,
		files: [...globs.ts],
	},
	{
		files: ['**/tests/**'],
		rules: {
			'id-length': 'off',
			'no-console': 'off',
		},
	},
];

export default config;
