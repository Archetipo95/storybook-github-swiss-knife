import FixtureButton from './FixtureButton.vue';

export default { title: 'Fixture/Button', component: FixtureButton };

export const Primary = { args: { label: 'Primary' } };

export const Hidden = { args: { label: 'Not screenshotted' }, tags: ['skip-visual'] };
