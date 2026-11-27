'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { localePath } from '@/lib/locale-path';
import { pehchaanTone } from './pehchaan-tones';

/**
 * Pehchaan tag (Ustaad UI upgrade E6; decisions 2026-11-27 "Pehchaan tag shape"): the member's level as a key-tag
 * chip — a flat tag with a punched hole on its left, like the brass tag on a workshop key board. The one bold shape of
 * the network (design doc § 1.4); colours are existing token pairs (`pehchaan-tones.ts`). It opens the level
 * explainer: `onOpen` when the page has one (U4's level sheet), otherwise a link to Me › levels. Renders nothing for
 * an unknown level code so a new level never shows a raw key.
 */
export function PehchaanTag({
  level,
  size = 'sm',
  onOpen,
  tone = 'default',
}: {
  level: string;
  size?: 'sm' | 'md';
  onOpen?: () => void;
  /** `light` on navy surfaces (the Ask question card). */
  tone?: 'default' | 'light';
}) {
  const l = useTranslations('ustaad.labels');
  const locale = useLocale();
  const key = `lvl_${level}` as 'lvl_naya';
  if (!l.has(key)) return null;
  const colours = tone === 'light' ? 'bg-white/15 text-white' : pehchaanTone(level).cls;
  const shape = `${pehchaanTagClass} ${size === 'md' ? 'min-h-8 px-3 text-sm' : 'min-h-6 px-2.5 text-xs'} ${colours}`;
  const body: ReactNode = (
    <>
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current opacity-60" />
      <span className="whitespace-nowrap">{l(key)}</span>
    </>
  );
  if (onOpen)
    return (
      <button
        type="button"
        onClick={onOpen}
        data-track="ustaad_level_tag"
        data-level={level}
        className={shape}
      >
        {body}
      </button>
    );
  return (
    <Link
      href={localePath('/ustaad/me#levels', locale)}
      data-track="ustaad_level_tag"
      data-level={level}
      className={shape}
    >
      {body}
    </Link>
  );
}

/** Shared shape (one place for the visual-language pass): key-tag outline, tokens only, focus ring, no clipping. */
export const pehchaanTagClass =
  'press inline-flex items-center gap-1.5 rounded-l-[6px] rounded-r-pill font-bold leading-[1.45] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** A member's name as written (user content, its own direction). */
export function MemberName({ name, className = '' }: { name: string; className?: string }) {
  return (
    <span data-user-content dir="auto" className={className}>
      {name}
    </span>
  );
}
