'use client';

import { BriefcaseBusiness, CalendarDays, ChartColumn, House, Wrench } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { PartnerFrame, type PartnerTab } from '@/components/partner';
import { AUTH_MODE } from '@/lib/auth/mode';
import { localePath } from '@/lib/locale-path';
import { WORKSHOP_TABS, legacyWorkshopTarget, type WorkshopTab } from '@/lib/workshop-portal-view';
import { PartnerGate } from '../partner-gate';
import { PortalGuard } from '../portal-guard';

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
  calendar: 'tab_calendar',
  numbers: 'tab_numbers',
  profile: 'tab_workshop',
} as const;
const TAB_ICON: Record<WorkshopTab, ReactNode> = {
  today: <House />,
  jobs: <BriefcaseBusiness />,
  calendar: <CalendarDays />,
  numbers: <ChartColumn />,
  profile: <Wrench />,
};

/**
 * The workshop portal frame (partner portals UI upgrade, batch B; design 2026-11-27 § 6.1): the guard, the partner
 * kit's bottom tabs and side rail and the demo gate live in the layout and stay mounted while the tabs change (no
 * reload feel). Old one-page anchors (`#jobs-title`, `#completed-jobs`) are sent on to the tab that now holds them.
 */
export function WorkshopFrame({ children }: { children: ReactNode }) {
  const api = AUTH_MODE === 'firebase';
  return (
    <PortalGuard role="workshop" path="/partner/workshop" demoNote={!api}>
      {(account) => (
        <Account.Provider value={{ slug: account.partner ?? '', api }}>
          <Frame>
            {api ? (
              children
            ) : (
              <PartnerGate kind="workshop" slug={account.partner ?? ''}>
                {children}
              </PartnerGate>
            )}
          </Frame>
        </Account.Provider>
      )}
    </PortalGuard>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const t = useTranslations('partnerWorkshop');
  const locale = useLocale();
  const router = useRouter();
  const tabs: PartnerTab[] = WORKSHOP_TABS.map((tab) => ({
    id: tab.key,
    href: tab.path,
    label: t(TAB_LABEL[tab.key]),
    icon: TAB_ICON[tab.key],
    exact: tab.key === 'today',
  }));

  useEffect(() => {
    const target = legacyWorkshopTarget(window.location.hash);
    if (target) router.replace(localePath(target, locale));
  }, [router, locale]);

  return (
    <PartnerFrame
      portal="workshop"
      navLabel={t('tabs_label')}
      railTitle={t('tabs_label')}
      tabs={tabs}
      strip={null}
    >
      {children}
    </PartnerFrame>
  );
}
