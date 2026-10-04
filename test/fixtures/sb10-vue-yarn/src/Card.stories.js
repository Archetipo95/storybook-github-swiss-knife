export default { title: 'Fixture/Card' };

export const Mobile = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  render: () => ({
    template: `<article style="border: 1px solid #cbd5e1; padding: 16px; font: 16px sans-serif; color: #0f172a">
      <h2 style="margin: 0; font-size: 20px">Mobile card</h2>
      <p>Rendered at the story's own viewport.</p>
    </article>`
  })
};
