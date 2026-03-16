const js = require('@eslint/js');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');
const prettier = require('eslint-config-prettier');

const tsFiles = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];
const tsRecommended = tsPlugin.configs['flat/recommended-type-checked'].map((config) => ({
  ...config,
  files: config.files ?? tsFiles,
}));

module.exports = [
  {
    ignores: [
      'dist',
      'node_modules',
      '**/*.js',
      '**/*.cjs',
      '.claude/**',
      'test',
      'test/**',
      'vitest.config.ts',
      '.codemachine/**',
      'examples/**/*.ts',
      'docs/research/**',
      'docs/brainstorms/**',
      'src/**/*.test.ts',
      'src/**/*.spec.ts',
    ],
  },
  js.configs.recommended,
  ...tsRecommended,
  {
    files: tsFiles,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.eslint.json',
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-restricted-types': [
        'warn',
        {
          types: {
            'Record<string, unknown>': {
              message:
                'Prefer a specific interface. If intentional (metadata, logging), add // eslint-disable-next-line with reason.',
            },
          },
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
    },
  },
  prettier,
];
