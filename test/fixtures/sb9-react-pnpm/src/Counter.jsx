import { useState } from 'react';

export const Counter = () => {
  const [count, setCount] = useState(0);
  return (
    <div style={{ font: '16px sans-serif', color: '#0f172a' }}>
      <p>Count: {count}</p>
      <button type="button" onClick={() => setCount(value => value + 1)}>
        Increment
      </button>
    </div>
  );
};
