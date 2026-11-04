import { Phone } from 'lucide-react';
import { site } from '@/lib/site';

export interface PolicySectionItem {
  emoji: string;
  title: string;
  body: string;
}

/**
 * The body of every policy page (privacy, returns, delivery, workshop bookings): one card per section with a
 * decorative emoji, then the support number and the "last updated" line. Server-only; the copy arrives
 * translated. When the storefront reads the content API, the same sections come from `GET /v1/content/policies`.
 */
export function PolicySections({
  sections,
  help,
  updated,
  track,
}: {
  sections: readonly PolicySectionItem[];
  help: string;
  updated: string;
  /** Analytics id of the call link (`data-track`). */
  track: string;
}) {
  return (
    <>
      <ul className="mt-10 grid max-w-4xl gap-4">
        {sections.map((s) => (
          <li
            key={s.title}
            className="flex gap-4 rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-6"
          >
            <span
              aria-hidden="true"
              className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent-soft text-[24px]"
            >
              {s.emoji}
            </span>
            <div>
              <h2 className="font-heading text-lg font-extrabold text-ink">{s.title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-8 flex max-w-4xl flex-wrap items-center gap-x-2 text-sm text-muted">
        {help}
        <a
          href={`tel:${site.supportPhoneE164}`}
          data-track={track}
          className="inline-flex min-h-11 items-center gap-2 font-bold text-ink underline-offset-4 hover:underline"
        >
          <Phone aria-hidden="true" className="size-4" />
          {site.supportPhone}
        </a>
      </p>
      <p className="mt-2 max-w-4xl text-xs text-muted">{updated}</p>
    </>
  );
}
