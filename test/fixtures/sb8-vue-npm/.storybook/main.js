/** @type {import('@storybook/vue3-vite').StorybookConfig} */
export default {
  framework: '@storybook/vue3-vite',
  stories: ['../src/**/*.stories.js'],
  addons: ['@storybook/addon-viewport'],
  core: { disableTelemetry: true }
};
