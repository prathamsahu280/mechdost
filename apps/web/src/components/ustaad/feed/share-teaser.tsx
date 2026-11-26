'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ShareTeaserResponse } from '@mechdost/shared/ustaad/dto/responses';
import { AUTH_MODE } from '@/lib/auth/mode';
import { localePath } from '@/lib/locale-path';
import { call } from '@/lib/orders-api';
import { socialClient } from '@/lib/ustaad/social-client';
import { useSession } from '@/demo/session';
import { useHydrated } from '@/demo/store';
import { ButtonLink } from '@/components/ui/button-link';
import { UstaadIcon } from '../shell/icons';

/**
 * The share teaser (spec 23 § 5 `/ustaad/s/[token]`, SR-44): what a WhatsApp link opens. A signed-in member is sent
 * straight to the post (`GET /ustaad/shares/{token}` → `/ustaad/p/{id}`, replacing the history entry). Everyone else
 * sees a generic card: no post text, no picture, no name, no count, only "A post on Ustaad Network. Sign in as a
 * mechanic to see it". A link that is not genuine or whose post is gone says so, with one next action.
 */
export function ShareTeaser({ token }: { token: string }) {
  const t = useTranslations('ustaad.feed');
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const session = useSession();
  const [state, setState] = useState<'checking' | 'card' | 'gone'>('checking');

  useEffect(() => {
    if (!hydrated) return;
    const alive = { current: true };
    void (async () => {
      if (session) {
        const r = await (await socialClient(locale)).openShare(token);
        if (!alive.current) return;
        if (r.ok) {
          router.replace(localePath(`/ustaad/p/${r.data.postId}`, locale));
          return;
        }
      }
      // Signed out (or not a member): the public check only says whether the link is live.
      const valid =
        AUTH_MODE === 'firebase'
          ? (await call(`/ustaad/s/${encodeURIComponent(token)}`, ShareTeaserResponse)).ok
          : true;
      if (alive.current) setState(valid ? 'card' : 'gone');
    })();
    return () => {
      alive.current = false;
    };
  }, [hydrated, session, token, locale, router]);

  if (state === 'checking')
    return (
      <p role="status" className="text-center text-[15px] text-muted">
        {t('teaserOpening')}
      </p>
    );
  const here = localePath(`/ustaad/s/${token}`, locale);
  return (
    <section className="mx-auto grid max-w-md justify-items-center gap-4 rounded-[26px] bg-navy p-8 text-center text-white shadow-float">
      <span className="flex size-16 items-center justify-center rounded-full bg-accent-button">
        <UstaadIcon name={state === 'gone' ? 'lock' : 'users'} size={32} />
      </span>
      <h1 className="font-heading text-2xl font-extrabold">
        {state === 'gone' ? t('teaserGone') : t('teaserTitle')}
      </h1>
      {state === 'card' ? (
        <p className="text-[16px] leading-relaxed text-white/85">{t('teaserBody')}</p>
      ) : null}
      {state === 'card' ? (
        <ButtonLink href={`/login?next=${encodeURIComponent(here)}`} data-track="ustaad_teaser_sign_in">
          {t('teaserSignIn')}
        </ButtonLink>
      ) : (
        <ButtonLink href="/" data-track="ustaad_teaser_home">
          {t('teaserHome')}
        </ButtonLink>
      )}
    </section>
  );
}
