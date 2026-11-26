import { redirect } from 'next/navigation';
import type { Locale } from '@/i18n/routing';
import { localePath } from '@/lib/locale-path';

interface Props {
  params: Promise<{ locale: Locale }>;
}

/** Spec 23 § 5 named `/ustaad/pin`; the screen lives at `/ustaad/me/location` (beside its API). Old links keep working. */
export default async function UstaadPinRedirect({ params }: Props) {
  const { locale } = await params;
  redirect(localePath('/ustaad/me/location', locale));
}
