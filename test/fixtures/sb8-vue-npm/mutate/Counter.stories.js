import { expect, userEvent, within } from '@storybook/test';

import FixtureCounter from './FixtureCounter.vue';

export default { title: 'Fixture/Counter', component: FixtureCounter };

export const InteractionIncrement = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Increment' }));
    await expect(canvas.getByText('Count: 2')).toBeVisible();
  }
};
