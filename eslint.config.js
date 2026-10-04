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
    ignores: ['node_modules/', '**/node_modules/', 'test/fixtures/', '.copilot/']
  }
];
