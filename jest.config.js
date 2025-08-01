/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
	moduleFileExtensions: ['js', 'json', 'ts', 'd.ts'],
	rootDir: './',
	testEnvironment: 'node',
	testRegex: '.spec.ts$',
	transform: {
		'^.+\\.(t|j)s$': ['ts-jest', { diagnostics: true }],
	},
	coverageDirectory: './coverage',
	collectCoverageFrom: ['src/**/*.ts', '!**/node_modules/**'],
	coveragePathIgnorePatterns: ['index.ts'],
};
