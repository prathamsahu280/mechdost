import { notFound } from 'next/navigation';
import * as rootParams from 'next/root-params';
import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { routing } from './routing';

/** Messages live in packages/shared so web, notifications and the mobile app share one source (hard rule 10). */
export default getRequestConfig(async ({ locale }) => {
  let resolved = locale;
  if (!resolved) {
    const param = await rootParams.locale();
    if (!hasLocale(routing.locales, param)) notFound();
    resolved = param;
  }
  const messages = (
    resolved === 'hi'
      ? await import('@mechdost/shared/i18n/hi.json')
      : await import('@mechdost/shared/i18n/en.json')
  ).default;
  return { locale: resolved, messages, timeZone: 'Asia/Kolkata' };
});
