import { getTranslations } from 'next-intl/server';
import { getPathname } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { site, whatsappLink } from '@/lib/site';
import type { AssistantCopy } from './copy';

/** Builds the assistant's translated copy and localised links on the server (no i18n runtime in the browser). */
export async function assistantCopy(locale: Locale): Promise<AssistantCopy> {
  const [t, wa] = await Promise.all([
    getTranslations({ locale, namespace: 'assistant' }),
    getTranslations({ locale, namespace: 'whatsapp' }),
  ]);
  const path = (href: string) => getPathname({ href, locale });
  const phone = site.supportPhone;
  return {
    launcher: t('launcher'),
    title: t('title'),
    subtitle: t('subtitle'),
    greeting: t('greeting'),
    placeholder: t('placeholder'),
    send: t('send'),
    close: t('close'),
    you: t('you'),
    bot: t('bot'),
    note: t('note', { phone }),
    suggestionsLabel: t('suggestionsLabel'),
    suggestions: [
      { intent: 'shop', label: t('s_shop') },
      { intent: 'workshop', label: t('s_workshop') },
      { intent: 'bulk', label: t('s_bulk') },
      { intent: 'track', label: t('s_track') },
      { intent: 'partner', label: t('s_partner') },
    ],
    answers: {
      shop: { text: t('a_shop'), action: { label: t('go_shop'), href: path('/shop') } },
      workshop: { text: t('a_workshop'), action: { label: t('go_workshops'), href: path('/workshops') } },
      bulk: {
        text: t('a_bulk'),
        action: { label: t('go_whatsapp'), href: whatsappLink(wa('bulk')), external: true },
      },
      track: { text: t('a_track'), action: { label: t('go_account'), href: path('/account') } },
      partner: { text: t('a_partner'), action: { label: t('go_partners'), href: path('/partners') } },
      contact: {
        text: t('a_contact', { phone }),
        action: { label: t('go_whatsapp'), href: whatsappLink(wa('general')), external: true },
      },
      fallback: {
        text: t('a_fallback'),
        action: { label: t('go_whatsapp'), href: whatsappLink(wa('general')), external: true },
      },
    },
  };
}
