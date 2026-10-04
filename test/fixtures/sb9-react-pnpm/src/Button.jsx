export const Button = ({ label, background = '#1d4ed8' }) => (
  <button type="button" style={{ background, color: '#ffffff', border: 0, padding: '12px 20px', font: '16px sans-serif' }}>
    {label}
  </button>
);
