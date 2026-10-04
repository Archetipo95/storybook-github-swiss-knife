export default { title: 'Fixture/Badge' };

const badges = labels => ({
  setup: () => ({ labels }),
  template: `<div style="display: flex; gap: 8px; font: 14px sans-serif">
    <span v-for="label in labels" :key="label" style="color: #9ca3af; background: #ffffff; padding: 4px">{{ label }}</span>
  </div>`
});

export const LowContrast = { render: () => badges(['Known issue', 'One more']) };
