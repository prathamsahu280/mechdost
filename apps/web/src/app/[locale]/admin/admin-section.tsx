import { getTranslations } from 'next-intl/server';
import type { TrustPlacement } from '@mechdost/shared/content';
import { AdminConsole } from '@/components/portal/admin-console';
import type { ContentDefaults } from '@/components/portal/admin-site';
import type { NotifyDefaults } from '@/components/portal/admin-notifications';
// Not from the 'use client' demo store: in a Server Component its exports are client references, not values.
import { WHATSAPP_TEMPLATES, type WhatsAppTemplateKey } from '@mechdost/shared/whatsapp';
import { whatsAppBodyText } from '@mechdost/shared/whatsapp-meta';
import type { AdminSection } from '@/lib/sections';
import { site } from '@/lib/site';

/** Default text for every admin-editable content key, in both locales (the editor shows them side by side). */
async function contentDefaults(): Promise<ContentDefaults> {
  const pick = async (locale: 'en' | 'hi') => {
    const announcement = await getTranslations({ locale, namespace: 'announcement' });
    const hero = await getTranslations({ locale, namespace: 'home.hero' });
    const region = (await getTranslations({ locale, namespace: 'regions' }))(site.defaultRegion);
    const trust = await getTranslations({ locale, namespace: 'trust' });
    const savings = await getTranslations({ locale, namespace: 'savings' });
    // The product line shows its {brand} token so the admin sees where the brand goes.
    const line = (p: TrustPlacement) => trust(p, { region, brand: '{brand}' });
    return {
      'announcement.orders': announcement('orders'),
      'announcement.workshops': announcement('workshops', { region }),
      'hero.eyebrow': hero('eyebrow'),
      'hero.titleLine1': hero('titleLine1'),
      'hero.titleLine2': hero('titleLine2'),
      'hero.lead': hero('lead', { region }),
      'trust.homeGenuine': line('homeGenuine'),
      'trust.homeBill': line('homeBill'),
      'trust.homeEstimates': line('homeEstimates'),
      'trust.product': line('product'),
      'trust.checkout': line('checkout'),
      'trust.emailFooter': line('emailFooter'),
      'trust.workshop': line('workshop'),
      'trust.partner': line('partner'),
      // The editor shows the {amount} token so the admin sees where the figure goes.
      'savings.order': savings('order', { amount: '{amount}' }),
      'savings.account': savings('account', { amount: '{amount}' }),
      'savings.cart': savings('cart'),
    };
  };
  const [en, hi] = await Promise.all([pick('en'), pick('hi')]);
  return Object.fromEntries(
    (Object.keys(en) as (keyof typeof en)[]).map((k) => [k, { en: en[k], hi: hi[k] }]),
  ) as ContentDefaults;
}

/**
 * Default WhatsApp message text per event in both languages. Read from `notify-templates/*.json`, not the ICU
 * locale files: the `{{n}}` placeholders are Meta's syntax, and the locale files are precompiled at build time
 * (spec 16, incident 2026-11-22).
 */
function notifyDefaults(): NotifyDefaults {
  return Object.fromEntries(
    (Object.keys(WHATSAPP_TEMPLATES) as WhatsAppTemplateKey[]).map((event) => [
      event,
      { en: whatsAppBodyText(event, 'en'), hi: whatsAppBodyText(event, 'hi') },
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
      notifyDefaults={section === 'notifications' ? notifyDefaults() : undefined}
    />
  );
}
