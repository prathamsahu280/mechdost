import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { AccountFrame } from '@/components/account/account-area';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container, PageIntro } from '@/components/ui/page-intro';

/**
 * Account frame (spec 01), shared by `/account` and `/account/[section]`: heading, message bundles, session check and
 * section bar stay mounted when a section link is clicked, so only the section swaps (user rule 2026-11-16,
 * decisions.md "No page may feel like a reload").
 */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('pages.account');
  return (
    <Container className="py-10 tab:py-14">
      <PageIntro eyebrow={t('eyebrow')} line1={t('title')} />
      <div className="mt-8">
        <ClientMessages
          namespaces={[
            'account',
            'auth',
            'cities',
            'order',
            'request',
            'quote',
            'support',
            'bell',
            'homeService',
            // Account -> Privacy (consents, data download, deletion request; design 2026-11-15).
            'privacy',
            // Real-sign-in (API) sections: invites, saved places, wishlist, support threads (audit 2026-11-16).
            'shopTier1',
            'accountApi',
            'storefront',
            'portal',
            'supportThread',
          ]}
        >
          <AccountFrame>{children}</AccountFrame>
        </ClientMessages>
      </div>
    </Container>
  );
}
