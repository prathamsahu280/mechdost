import { getTranslations } from 'next-intl/server';
import { AccountArea } from '@/components/account/account-area';
import type { AccountSection } from '@/lib/sections';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container, PageIntro } from '@/components/ui/page-intro';

/** Shared account page frame (spec 01): heading + the client account area for one section. */
export async function AccountShell({ section }: { section: AccountSection }) {
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
          ]}
        >
          <AccountArea section={section} />
        </ClientMessages>
      </div>
    </Container>
  );
}
