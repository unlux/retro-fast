import * as React from 'react';

/** A single decorative burst after Jira confirms a successful push. */
export function CompletionConfetti() {
  const [visible, setVisible] = React.useState(true);
  React.useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 1800);
    return () => clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return <div className="completion-confetti" aria-hidden="true" data-testid="completion-confetti">
    {Array.from({ length: 36 }, (_, index) => <span key={index} style={{
      left: `${(index * 31) % 100}%`,
      backgroundColor: ['var(--color-brand)', 'var(--color-success)', '#f5cd47'][index % 3],
      '--confetti-drift': `${(index % 2 ? 1 : -1) * (30 + index * 4)}px`,
      '--confetti-turn': `${(index % 2 ? 1 : -1) * (180 + index * 23)}deg`,
      animationDelay: `${(index % 6) * 60}ms`,
    } as React.CSSProperties} />)}
  </div>;
}
