'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { track } from '@/lib/analytics';
import { AUTH_MODE } from '@/lib/auth/mode';
import { localePath, stripLocale } from '@/lib/locale-path';
import { WORKSHOP_TABS, legacyWorkshopTarget, workshopTabFor } from '@/lib/workshop-portal-view';
import { PartnerGate } from '../partner-gate';
import { PortalGuard } from '../portal-guard';
import { PartnerTabs } from './_kit-shim';

interface WorkshopAccount {
  /** Demo builds: the signed-in workshop's slug. */
  slug: string;
  /** Real sign-in: the tabs read and act through the API. */
  api: boolean;
}
const Account = createContext<WorkshopAccount | null>(null);
export const useWorkshopAccount = (): WorkshopAccount | null => useContext(Account);

const TAB_LABEL = {
  today: 'tab_today',
  jobs: 'tab_jobs',
  numbers: 'tab_numbers',
  profile: 'tab_workshop',
} as const;

/**
 * The workshop portal frame (partner portals UI upgrade, batch B; design 2026-11-27 § 6.1): the guard, the tab bar and
 * the demo gate live in the layout and stay mounted while the tabs change (no reload feel). Old one-page anchors
 * (`#jobs-title`, `#completed-jobs`) are sent on to the tab that now holds them.
 */
export function WorkshopFrame({ children }: { children: ReactNode }) {
  const api = AUTH_MODE === 'firebase';
  return (
    <PortalGuard role="workshop" path="/partner/workshop" demoNote={!api}>
      {(account) => (
        <Account.Provider value={{ slug: account.partner ?? '', api }}>
          <div className="grid gap-6">
            <WorkshopTabs />
            {api ? (
              children
            ) : (
              <PartnerGate kind="workshop" slug={account.partner ?? ''}>
                {children}
              </PartnerGate>
            )}
          </div>
        </Account.Provider>
      )}
    </PortalGuard>
  );
}

function WorkshopTabs() {
  const t = useTranslations('partnerWorkshop');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const current = workshopTabFor(stripLocale(pathname));

  useEffect(() => {
    track('partner_tab_viewed', { portal: 'workshop', tab: current });
  }, [current]);

  useEffect(() => {
    const target = legacyWorkshopTarget(window.location.hash);
    if (target) router.replace(localePath(target, locale));
  }, [router, locale]);

  return (
    <PartnerTabs
      label={t('tabs_label')}
      current={current}
      tabs={WORKSHOP_TABS.map((tab) => ({ key: tab.key, href: tab.path, label: t(TAB_LABEL[tab.key]) }))}
    />
  );
}
