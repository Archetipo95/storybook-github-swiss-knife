export const Button = ({ label, background = '#7c2d12' }) => (
  <button type="button" style={{ background, color: '#ffffff', border: 0, padding: '12px 20px', font: '16px sans-serif' }}>
    {label}
  </button>
);
