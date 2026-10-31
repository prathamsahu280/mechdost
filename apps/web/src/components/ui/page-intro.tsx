import type { ReactNode } from 'react';

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`eyebrow text-muted ${className}`}>{children}</p>;
}

/**
 * Concept section heading: small eyebrow, two-line Manrope title (second line optional), lead paragraph.
 * `as` lets the page's first heading be the h1 and later ones h2.
 */
export function PageIntro({
  eyebrow,
  line1,
  line2,
  lead,
  as: Heading = 'h1',
}: {
  eyebrow: string;
  line1: string;
  line2?: string;
  lead?: string;
  as?: 'h1' | 'h2';
}) {
  return (
    <header className="max-w-3xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <Heading className="mt-4 font-heading text-[clamp(34px,4vw,56px)] leading-[1.05] font-extrabold tracking-[-0.03em] text-ink">
        {line1}
        {line2 ? (
          <>
            <br />
            {line2}
          </>
        ) : null}
      </Heading>
      {lead ? <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-muted">{lead}</p> : null}
    </header>
  );
}

/** Calm empty state: one message, one next action (hard rule 2). */
export function EmptyState({ title, body, action }: { title?: string; body: string; action: ReactNode }) {
  return (
    <div className="rounded-card border border-line-card bg-surface p-7 shadow-card sm:p-9">
      {title ? <h2 className="font-heading text-xl font-extrabold text-ink">{title}</h2> : null}
      <p className={`max-w-2xl text-[15px] leading-relaxed text-muted ${title ? 'mt-3' : ''}`}>{body}</p>
      <div className="mt-6">{action}</div>
    </div>
  );
}

/** Page width and gutters from the concept: max 1600px, 5% side padding. */
export function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1600px] px-[5%] ${className}`}>{children}</div>;
}
