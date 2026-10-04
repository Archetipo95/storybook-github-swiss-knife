import { expect, userEvent, within } from 'storybook/test';

import { Counter } from './Counter.jsx';

export default { title: 'Fixture/Counter', component: Counter };

export const InteractionIncrement = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Increment' }));
    await expect(canvas.getByText('Count: 2')).toBeVisible();
  }
};
