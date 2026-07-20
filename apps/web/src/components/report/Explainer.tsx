/**
 * Opportunity-report explainer cards ("How it works" / "What to do about it") — the plain-language
 * framing that makes each report actionable for non-expert users (ref the opportunity screenshots).
 */

import type { ReactNode } from 'react';

export function Explainer({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2">
      {items.map((it) => (
        <div key={it.title} className="rounded-xl border border-line bg-surface-2/40 p-4">
          <p className="mb-1 text-sm font-semibold text-fg">{it.title}</p>
          <div className="text-sm leading-relaxed text-muted">{it.body}</div>
        </div>
      ))}
    </div>
  );
}
