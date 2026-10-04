export default {
  // a11y.test 'error' makes Storybook fail a story on any axe violation (storyFinished status
  // 'error'); the runner must still judge accessibility by the baseline, not as a story failure.
  parameters: { layout: 'padded', a11y: { test: 'error' } },
  initialGlobals: { viewport: { value: undefined, isRotated: false } }
};
