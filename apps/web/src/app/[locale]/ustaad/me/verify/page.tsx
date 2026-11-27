import { redirect } from 'next/navigation';
import type { Locale } from '@/i18n/routing';
import { localePath } from '@/lib/locale-path';

interface Props {
  params: Promise<{ locale: Locale }>;
}

/** SIM-RT2: verification bell rows stored before the SIM-P19 fix link here; verification lives on Me. */
export default async function UstaadVerifyRedirect({ params }: Props) {
  const { locale } = await params;
  redirect(localePath('/ustaad/me', locale));
}
