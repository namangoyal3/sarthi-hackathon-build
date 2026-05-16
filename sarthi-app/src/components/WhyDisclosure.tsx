import type { ReactNode } from 'react';

interface WhyDisclosureProps {
  // Short label on the closed row, e.g. "Why this?" or "Show the proof".
  label?: string;
  children: ReactNode;
}

// Collapsible "proof drawer". Drivers see the decision and the number first;
// the reasoning trace, sources and tool detail live one tap away. Native
// <details> so it is keyboard-accessible and needs no JS state.
export default function WhyDisclosure({
  label = 'Why this?',
  children,
}: WhyDisclosureProps) {
  return (
    <details className="why">
      <summary className="why-summary">
        <span>{label}</span>
        <span className="why-chev" aria-hidden>
          ▾
        </span>
      </summary>
      <div className="why-body">{children}</div>
    </details>
  );
}
