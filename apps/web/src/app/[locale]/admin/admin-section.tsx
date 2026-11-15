import { getTranslations } from 'next-intl/server';
import type { TrustPlacement } from '@mechdost/shared/content';
import { AdminConsole } from '@/components/portal/admin-console';
import type { ContentDefaults } from '@/components/portal/admin-site';
import type { NotifyDefaults } from '@/components/portal/admin-notifications';
// Not from the 'use client' demo store: in a Server Component its exports are client references, not values.
import { WHATSAPP_TEMPLATES, type WhatsAppTemplateKey } from '@mechdost/shared/whatsapp';
import type { AdminSection } from '@/lib/sections';
import { site } from '@/lib/site';

/** Default text for every admin-editable content key, in both locales (the editor shows them side by side). */
async function contentDefaults(): Promise<ContentDefaults> {
  const pick = async (locale: 'en' | 'hi') => {
    const announcement = await getTranslations({ locale, namespace: 'announcement' });
    const hero = await getTranslations({ locale, namespace: 'home.hero' });
    const city = (await getTranslations({ locale, namespace: 'cities' }))(site.defaultCity);
    const trust = await getTranslations({ locale, namespace: 'trust' });
    // The product line shows its {brand} token so the admin sees where the brand goes.
    const line = (p: TrustPlacement) => trust(p, { city, brand: '{brand}' });
    return {
      'announcement.orders': announcement('orders'),
      'announcement.workshops': announcement('workshops', { city }),
      'hero.eyebrow': hero('eyebrow'),
      'hero.titleLine1': hero('titleLine1'),
      'hero.titleLine2': hero('titleLine2'),
      'hero.lead': hero('lead', { city }),
      'trust.homeGenuine': line('homeGenuine'),
      'trust.homeBill': line('homeBill'),
      'trust.homeEstimates': line('homeEstimates'),
      'trust.product': line('product'),
      'trust.checkout': line('checkout'),
      'trust.emailFooter': line('emailFooter'),
      'trust.workshop': line('workshop'),
      'trust.partner': line('partner'),
    };
  };
  const [en, hi] = await Promise.all([pick('en'), pick('hi')]);
  return Object.fromEntries(
    (Object.keys(en) as (keyof typeof en)[]).map((k) => [k, { en: en[k], hi: hi[k] }]),
  ) as ContentDefaults;
}

/**
 * Default WhatsApp message text per event in both languages. Read raw: the `{{n}}` placeholders are Meta's
 * syntax, not ICU arguments.
 */
async function notifyDefaults(): Promise<NotifyDefaults> {
  const [en, hi] = await Promise.all([
    getTranslations({ locale: 'en', namespace: 'notifyTemplates' }),
    getTranslations({ locale: 'hi', namespace: 'notifyTemplates' }),
  ]);
  return Object.fromEntries(
    (Object.keys(WHATSAPP_TEMPLATES) as WhatsAppTemplateKey[]).map((event) => [
      event,
      { en: String(en.raw(event)), hi: String(hi.raw(event)) },
    ]),
  ) as NotifyDefaults;
}

/**
 * One admin section's content (spec 08). The frame (guard, side bar, heading, message bundles) is `layout.tsx` and
 * stays mounted between sections; only this part is replaced on a click. Demo mode: data from the browser store,
 * role from the demo session.
 */
export async function AdminSectionContent({ section }: { section: AdminSection }) {
  return (
    <AdminConsole
      section={section}
      contentDefaults={section === 'content' ? await contentDefaults() : undefined}
      notifyDefaults={section === 'notifications' ? await notifyDefaults() : undefined}
    />
  );
}
