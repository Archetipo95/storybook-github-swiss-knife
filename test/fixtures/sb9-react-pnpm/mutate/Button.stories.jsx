import { Button } from './Button.jsx';

export default { title: 'Fixture/Button', component: Button };

// No violations, but turns off an enforced rule: the gate must still block it.
export const Primary = {
  args: { label: 'Primary' },
  parameters: { a11y: { config: { rules: [{ id: 'image-alt', enabled: false }] } } }
};

export const Hidden = { args: { label: 'Not screenshotted' }, tags: ['skip-visual'] };

export const Secondary = { args: { label: 'Secondary', background: '#047857' } };
