'use client';

import { History, Inbox, PackageCheck, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { PartnerTab } from '@/components/partner';

/** The rider portal's four tabs (spec 24) for the partner frame: Offers · My jobs · History · Profile. */
export function useRiderTabs(): PartnerTab[] {
  const t = useTranslations('deliveryAgent');
  return [
    { id: 'offers', href: '/partner/delivery', label: t('tab_offers'), icon: <Inbox />, exact: true },
    { id: 'jobs', href: '/partner/delivery/jobs', label: t('tab_jobs'), icon: <PackageCheck /> },
    { id: 'history', href: '/partner/delivery/history', label: t('tab_history'), icon: <History /> },
    { id: 'profile', href: '/partner/delivery/profile', label: t('tab_profile'), icon: <UserRound /> },
  ];
}
