import globals from 'globals';

export default [
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error'
    }
  },
  {
    // Serialized by Playwright and run inside the Storybook preview.
    files: ['runner/lib/browser.js'],
    languageOptions: { globals: { ...globals.browser } }
  },
  {
    // The Storybook addon: runs in the manager, JSX compiled to React.createElement.
    files: ['packages/addon/src/**/*.{js,jsx}'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, process: 'readonly' }
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^(_|React$)' }]
    }
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' }
  },
  {
    ignores: ['packages/addon/dist/', 'node_modules/', '**/node_modules/', 'test/fixtures/', '.copilot/']
  }
];
