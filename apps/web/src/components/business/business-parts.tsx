import type { ReactNode } from 'react';
import { ButtonLink } from '../ui/button-link';
import { LocalLink } from '../ui/local-link';

/**
 * Pieces shared by the two business landing pages (design 2026-11-22). Server components only: the pages are
 * static copy with links. Status is always words, never colour alone (WCAG 1.4.1).
 */
export function StatusLabel({ tone, children }: { tone: 'live' | 'soon'; children: ReactNode }) {
  return (
    <span
      className={`inline-flex min-h-6 items-center rounded-pill px-3 text-xs font-bold ${
        tone === 'live' ? 'bg-success-bg text-success' : 'bg-pill text-ink'
      }`}
    >
      {children}
    </span>
  );
}

/** One benefit: an h2, a status label (optional), the text and an optional secondary link. */
export function Benefit({
  title,
  body,
  status,
  link,
}: {
  title: string;
  body: string;
  status?: ReactNode;
  link?: { href: string; label: string; track: string };
}) {
  return (
    <li className="flex flex-col rounded-card border border-line-card bg-surface p-6 shadow-card">
      {status ? <div className="mb-3">{status}</div> : null}
      <h2 className="font-heading text-xl font-extrabold text-ink">{title}</h2>
      <p className="mt-2 flex-1 text-sm text-muted">{body}</p>
      {link ? (
        <LocalLink
          href={link.href}
          data-track={link.track}
          className="mt-4 inline-flex min-h-11 items-center text-sm font-bold text-accent-soft-text underline underline-offset-4"
        >
          {link.label}
        </LocalLink>
      ) : null}
    </li>
  );
}

/** The page's one primary action, in a calm closing panel. */
export function ApplyPanel({
  title,
  body,
  action,
  href,
  track,
}: {
  title: string;
  body: string;
  action: string;
  href: string;
  track: string;
}) {
  return (
    <section
      aria-labelledby="business-apply-title"
      className="mt-10 rounded-hero border border-line-card bg-surface p-8 shadow-card tab:p-10"
    >
      <h2 id="business-apply-title" className="font-heading text-2xl font-extrabold text-ink">
        {title}
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-muted">{body}</p>
      <ButtonLink href={href} data-track={track} className="mt-5">
        {action}
      </ButtonLink>
    </section>
  );
}
