// @ts-check
import tsEslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'

export default [
  {
    ignores: ['dist/**', 'node_modules/**', '.wrangler/**', 'drizzle/**', 'worker-configuration.d.ts'],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tsEslint,
    },
    rules: {
      ...tsEslint.configs.recommended.rules,
    },
  },
]
