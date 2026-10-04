const Card = ({ title }) => (
  <article style={{ border: '1px solid #cbd5e1', padding: 16, font: '16px sans-serif', color: '#0f172a' }}>
    <h2 style={{ margin: 0, fontSize: 20 }}>{title}</h2>
    <p>Rendered at the story's own viewport.</p>
  </article>
);

export default { title: 'Fixture/Card', component: Card };

export const Mobile = { args: { title: 'Mobile card' }, globals: { viewport: { value: 'mobile1', isRotated: false } } };

export const OptedOut = { args: { title: 'Not compared' }, parameters: { swissKnife: { visual: { skip: true } } } };
