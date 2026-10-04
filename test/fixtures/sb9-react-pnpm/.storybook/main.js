/** @type {import('@storybook/react-vite').StorybookConfig} */
export default {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.jsx'],
  addons: ['@storybook/addon-a11y'],
  core: { disableTelemetry: true }
};
