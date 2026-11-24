import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AdminFrame } from '@/components/portal/admin-console';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container, PageIntro } from '@/components/ui/page-intro';

/**
 * Admin console frame (spec 08), shared by `/admin` and `/admin/[section]`. A layout stays mounted when the admin
 * clicks a side-bar link, so the heading, the message bundles, the guard and the side bar are not rebuilt and the
 * page does not feel reloaded (user rule 2026-11-16, decisions.md "No page may feel like a reload"). Sections are
 * pages (`admin-section.tsx`).
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('portal');
  return (
    <Container className="py-10 tab:py-14">
      <PageIntro eyebrow="MechDost" line1={t('adminTitle')} />
      <div className="mt-8">
        <ClientMessages
          namespaces={[
            'portal',
            'roadside',
            // Admin → Applications → trade accounts and fleet enquiries (audience entry design 2026-11-22).
            'business',
            'account',
            'auth',
            'order',
            'request',
            'quote',
            'apply',
            'categories',
            'support',
            // Admin → Catalogue: vehicle type labels and specification names/values (plan 2026-11-14 B).
            'catalogue',
            'compare',
            // Admin → Reviews (moderation queue on the API, 2026-11-14).
            'reviews',
            // The bell's push card on the admin home (spec 10, 2026-11-15).
            'bell',
            // Admin → Notifications → Messages: the bell and push texts (spec 10).
            'adminNotices',
            // Admin → Content trust lines, the agreement clause and the labour promise (design 2026-11-15).
            'trust',
            // Admin → Workshops: home servicing fields (spec 06, 2026-11-15).
            'homeService',
            // Admin → Staff, Customers (search and view) and Audit log (design 2026-11-15).
            'adminPeople',
            // Admin -> Catalogue rules for "goes well with" and Settings -> PIN waiting list (design 2026-11-15).
            'adminReco',
            'adminDemand',
            // Real-sign-in (API) admin screens (audit 2026-11-16).
            'adminEmails',
            'adminTier2',
            // Admin → Settings: categories, search, save bar and one-line help per setting (design 2026-11-24).
            'adminSettings',
            'coupons',
            'adminExports',
            'refunds',
            'workshopAnalytics',
            'shopGiveUp',
            'supportThread',
            'storefront',
          ]}
        >
          <AdminFrame>{children}</AdminFrame>
        </ClientMessages>
      </div>
    </Container>
  );
}
