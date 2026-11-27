import { redirect } from 'next/navigation';
import type { Locale } from '@/i18n/routing';
import { localePath } from '@/lib/locale-path';

interface Props {
  params: Promise<{ locale: Locale }>;
}

/**
 * SIM-RT2: bell rows stored before the SIM-P19 fix link here. The member's notices live on `/notifications`;
 * strike and removal notices now link to `/ustaad/me/standing`. Old links keep working.
 */
export default async function UstaadNotificationsRedirect({ params }: Props) {
  const { locale } = await params;
  redirect(localePath('/notifications', locale));
}
