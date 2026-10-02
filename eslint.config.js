import { defineConfig, GLOB_TESTS } from '@stimulcross/eslint-config'

export default defineConfig(
	{
		test: true,
		pnpm: true,
		node: true,
		markdown: { gfm: false },
		formatters: { markdown: 'prettier' },
		typescript: {
			tsconfigPath: './tsconfig.json',
		},
		unicorn: {
			overrides: {
				'unicorn/filename-case': 'off',
			},
		},
	},
	{
		files: [...GLOB_TESTS],
		rules: {
			'no-throw-literal': 'off',
			'prefer-arrow-callback': 'off',
			'ts/naming-convention': 'off',
			'ts/no-explicit-any': 'off',
			'ts/no-unsafe-argument': 'off',
			'ts/no-unsafe-assignment': 'off',
			'ts/no-unsafe-member-access': 'off',
			'ts/only-throw-error': 'off',
		},
	},
)
