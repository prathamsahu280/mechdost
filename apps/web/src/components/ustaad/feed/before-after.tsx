'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import type { PostMediaView } from '@mechdost/shared/ustaad/dto/feed';
import { track } from '@/lib/analytics';
import { SignedImage } from './social-common';

/**
 * Before | After (Ustaad UI upgrade E8): under 600 px a two-option radio group picks which photo shows (keyboard:
 * arrows move, like any radio group); from 600 px both photos sit side by side and the toggle is hidden. Photos carry
 * their role in the alt text. `ustaad_before_after_toggled {to}`.
 */
export function BeforeAfter({
  before,
  after,
  eager = false,
}: {
  before: PostMediaView;
  after: PostMediaView;
  eager?: boolean;
}) {
  const t = useTranslations('ustaad.feed');
  const name = useId();
  const [side, setSide] = useState<'before' | 'after'>('after');
  const choose = (to: 'before' | 'after') => {
    setSide(to);
    track('ustaad_before_after_toggled', { to });
  };
  const photo = (m: PostMediaView, role: 'before' | 'after', hiddenSmall: boolean) => (
    <figure className={`relative ${hiddenSmall ? 'hidden min-[600px]:block' : ''}`}>
      <SignedImage
        mediaId={m.mediaId}
        width={m.width}
        height={m.height}
        eager={eager && role === 'after'}
        alt={t(role)}
      />
      <figcaption
        aria-hidden="true"
        className="absolute top-3 left-3 rounded-pill bg-navy px-3 py-1 text-sm font-bold text-white"
      >
        {t(role)}
      </figcaption>
    </figure>
  );
  return (
    <div className="grid gap-2">
      <fieldset className="mx-4 min-[600px]:hidden">
        <legend className="sr-only">{t('beforeAfterAria')}</legend>
        <div className="grid grid-cols-2 rounded-button bg-pill p-1">
          {(['before', 'after'] as const).map((s) => (
            <label
              key={s}
              className={`press relative flex min-h-11 cursor-pointer items-center justify-center rounded-[7px] text-[15px] font-bold has-focus-visible:outline-3 has-focus-visible:outline-focus ${side === s ? 'bg-surface text-ink shadow-card' : 'text-muted'}`}
            >
              <input
                type="radio"
                name={name}
                value={s}
                checked={side === s}
                onChange={() => {
                  choose(s);
                }}
                className="sr-only"
              />
              {t(s)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-2 min-[600px]:grid-cols-2">
        {photo(before, 'before', side !== 'before')}
        {photo(after, 'after', side !== 'after')}
      </div>
    </div>
  );
}
