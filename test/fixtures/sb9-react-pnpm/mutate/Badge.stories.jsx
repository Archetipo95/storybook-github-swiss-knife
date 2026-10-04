const Badge = ({ labels }) => (
  <div style={{ display: 'flex', gap: 8, font: '14px sans-serif' }}>
    {labels.map(label => (
      <span key={label} style={{ color: '#9ca3af', background: '#ffffff', padding: 4 }}>
        {label}
      </span>
    ))}
  </div>
);

export default { title: 'Fixture/Badge', component: Badge };

export const LowContrast = { args: { labels: ['Known issue', 'One more'] } };
