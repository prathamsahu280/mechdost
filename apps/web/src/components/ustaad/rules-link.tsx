'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { localePath } from '@/lib/locale-path';

/**
 * "Read the network rules" (QA audit 2026-11-27, row 11): a small text link to the community rules, with a 24 px
 * target (WCAG 2.5.8). `place` names where it sits for the click event (`ustaad_rules_link_<place>`). Needs the
 * `ustaad.shell` messages, which every Ustaad member page already loads.
 */
export function RulesLink({
  place,
  className = '',
  inheritColor = false,
}: {
  place: string;
  className?: string;
  /** Inside a tinted note: keep the note's text colour (already contrast-tested on that background). */
  inheritColor?: boolean;
}) {
  const t = useTranslations('ustaad.shell');
  const locale = useLocale();
  return (
    <Link
      href={localePath('/policies/community-rules', locale)}
      data-track={`ustaad_rules_link_${place}`}
      className={`inline-flex min-h-6 w-fit items-center rounded text-sm font-bold underline underline-offset-4 focus-visible:outline-3 focus-visible:outline-focus ${inheritColor ? 'text-current' : 'text-accent-soft-text'} ${className}`}
    >
      {t('rulesLink')}
    </Link>
  );
}
