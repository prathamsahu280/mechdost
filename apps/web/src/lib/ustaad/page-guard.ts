import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { DATA_MODE } from '@/lib/data-mode';
import { SIGNED_IN_HINT, ustaadHiddenOnServer } from '@/lib/signed-in-hint';
import { publishedUstaadAccess } from '@/lib/site-config-content';

/**
 * The Mechanic Network's server guard for a page (SIM-B1, live fix 2026-11-28). The layout runs the same check, but
 * Next renders a page in parallel with its layout, so a page's own ClientMessages reached the 404 HTML of a viewer the
 * network is hidden from. Every `/ustaad` page awaits this first: off → 404; staff preview and signed out → 404.
 */
export async function guardUstaadPage(): Promise<void> {
  const access = await publishedUstaadAccess();
  if (access === 'off') notFound();
  if (ustaadHiddenOnServer(access, (await cookies()).get(SIGNED_IN_HINT)?.value, DATA_MODE)) notFound();
}
