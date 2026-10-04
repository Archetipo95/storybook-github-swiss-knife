import { Button } from './Button.jsx';

export default { title: 'Fixture/Button', component: Button };

export const Primary = { args: { label: 'Primary' } };

export const Hidden = { args: { label: 'Not screenshotted' }, tags: ['skip-visual'] };
