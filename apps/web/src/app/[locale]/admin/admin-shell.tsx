import { getTranslations } from 'next-intl/server';
import { AdminConsole } from '@/components/portal/admin-console';
import type { AdminSection } from '@/lib/sections';
import { ClientMessages } from '@/components/ui/client-messages';
import { Container, PageIntro } from '@/components/ui/page-intro';

/** Admin console frame (spec 08). Demo mode: data from the browser store, role from the demo session. */
export async function AdminShell({ section }: { section: AdminSection }) {
  const t = await getTranslations('portal');
  return (
    <Container className="py-10 tab:py-14">
      <PageIntro eyebrow="MechDost" line1={t('adminTitle')} />
      <div className="mt-8">
        <ClientMessages namespaces={['portal', 'account', 'auth', 'order', 'request', 'quote', 'apply']}>
          <AdminConsole section={section} />
        </ClientMessages>
      </div>
    </Container>
  );
}
