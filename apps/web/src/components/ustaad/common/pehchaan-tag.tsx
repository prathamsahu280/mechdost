'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { localePath } from '@/lib/locale-path';
import { pehchaanTone } from './pehchaan-tones';

/**
 * Pehchaan tag (UI upgrade E6; visual language "Bench kit" § 3.3/3.5, decision 2026-11-27 night): the member's level
 * as a key tag — a point on the left with a 6 px punched hole, 7 px right corners, a 1 px edge (outer clip in the edge
 * colour, inner clip in the fill), the level word and 0–4 grade lines (lines = how far you have come, like the marks
 * on a bolt head). Shapes are CSS `clip-path` + a radial mask, no image. Opens `onOpen` when the page has the level
 * sheet (U4), otherwise links to Me › levels; `interactive={false}` inside rows that are links themselves. Renders
 * nothing for an unknown level code so a new level never shows a raw key.
 */
const OUTER =
  'rounded-r-[7px] [clip-path:polygon(8px_0,100%_0,100%_100%,8px_100%,0_50%)] [mask:radial-gradient(circle_4px_at_11px_50%,transparent_96%,black_100%)]';
const INNER =
  'rounded-r-[6px] [clip-path:polygon(7px_0,100%_0,100%_100%,7px_100%,0_50%)] [mask:radial-gradient(circle_3px_at_10px_50%,transparent_96%,black_100%)]';

export function PehchaanTag({
  level,
  size = 'sm',
  onOpen,
  tone = 'default',
  interactive = true,
}: {
  level: string;
  size?: 'sm' | 'md';
  onOpen?: () => void;
  /** `light` on navy surfaces (the Ask question card): edges switch to a light token so they show on navy. */
  tone?: 'default' | 'light';
  /** false inside a row that is itself a link or button (no nested interactive controls). */
  interactive?: boolean;
}) {
  const l = useTranslations('ustaad.labels');
  const locale = useLocale();
  const key = `lvl_${level}` as 'lvl_naya';
  if (!l.has(key)) return null;
  const t = pehchaanTone(level);
  const edge = tone === 'light' ? (level === 'master' ? 'bg-accent-light' : 'bg-hero-copy') : t.cls.edge;
  const body: ReactNode = (
    <span className={`inline-flex p-px ${OUTER} ${edge}`}>
      <span
        className={`inline-flex items-center gap-1.5 pr-2.5 pl-[18px] leading-[1.45] font-bold ${size === 'md' ? 'min-h-8 text-sm' : 'min-h-6 text-xs'} ${INNER} ${t.cls.fill}`}
      >
        <span className="whitespace-nowrap">{l(key)}</span>
        {t.lines > 0 ? (
          <span aria-hidden="true" className="inline-flex gap-[2px]">
            {Array.from({ length: t.lines }, (_, i) => (
              <span key={i} className="h-2.5 w-[2px] rounded-full bg-current opacity-80" />
            ))}
          </span>
        ) : null}
      </span>
    </span>
  );
  if (!interactive) return <span className="inline-flex">{body}</span>;
  if (onOpen)
    return (
      <button
        type="button"
        onClick={onOpen}
        data-track="ustaad_level_tag"
        data-level={level}
        className={pehchaanTagClass}
      >
        {body}
      </button>
    );
  return (
    <Link
      href={localePath('/ustaad/me#levels', locale)}
      data-track="ustaad_level_tag"
      data-level={level}
      className={pehchaanTagClass}
    >
      {body}
    </Link>
  );
}

/** Focus and press for the interactive tag (one place for the polish pass; motion only under motion-safe). */
export const pehchaanTagClass =
  'press inline-flex min-h-6 items-center rounded-[7px] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus motion-safe:transition-transform motion-safe:active:-rotate-3';

/** A member's name as written (user content, its own direction). */
export function MemberName({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span data-user-content dir="auto" className={className}>
      {name}
    </span>
  );
}
