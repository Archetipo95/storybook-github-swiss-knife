export const Button = ({ label, background = '#b91c1c' }) => (
  <button type="button" style={{ background, color: '#ffffff', border: 0, padding: '12px 20px', font: '16px sans-serif' }}>
    {label}
  </button>
);
