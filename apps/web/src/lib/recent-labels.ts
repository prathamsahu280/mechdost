import { getTranslations } from 'next-intl/server';
import type { RecentLabels } from '@/components/personalisation/recently-viewed';

/** The "Recently viewed" texts for the lazy list, read on the server (the list's chunk carries no messages). */
export async function recentLabels(): Promise<RecentLabels> {
  const t = await getTranslations('recent');
  return {
    title: t('title'),
    clear: t('clear'),
    clearName: t('clearName'),
    cleared: t('cleared'),
    switch: t('switch'),
    switchHelp: t('switchHelp'),
  };
}
