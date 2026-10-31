import { getTranslations } from 'next-intl/server';
import { AccountActivity } from '@/components/commerce/account-activity';
import { ButtonLink } from '@/components/ui/button-link';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container, EmptyState, PageIntro } from '@/components/ui/page-intro';

/**
 * Account home until phone-OTP sign-in ships (spec 01, inbox Q3): sign-in explainer plus the orders and service
 * requests made on this device (demo store).
 */
export async function AccountPlaceholder() {
  const t = await getTranslations('pages.account');
  return (
    <Container className="py-12 tab:py-16">
      <PageIntro eyebrow={t('eyebrow')} line1={t('title')} />
      <div className="mt-8">
        <ClientMessages namespaces={['order', 'request']}>
          <AccountActivity />
        </ClientMessages>
      </div>
      <div className="mt-10">
        <EmptyState
          body={t('lead')}
          action={
            <ButtonLink href="/shop" data-track="account_shop">
              {t('action')}
            </ButtonLink>
          }
        />
      </div>
    </Container>
  );
}
