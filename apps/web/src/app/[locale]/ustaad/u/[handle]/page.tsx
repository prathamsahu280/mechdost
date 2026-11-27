import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { ProfileScreen } from '@/components/ustaad/feed/profile-screen';
import { guardUstaadPage } from '@/lib/ustaad/page-guard';

export const metadata: Metadata = { robots: { index: false, follow: false } };

interface Props {
  params: Promise<{ handle: string }>;
}

const HANDLE = /^[A-Za-z0-9_]{3,24}$/;

/** `/ustaad/u/[handle]` (spec 23 § 5, decision 2026-11-26 "D web"): a member's profile. Bad shapes 404 first. */
export default async function UstaadProfilePage({ params }: Props) {
  await guardUstaadPage();
  const { handle } = await params;
  if (!HANDLE.test(handle)) notFound();
  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <ClientMessages
        namespaces={[
          'ustaad.shell',
          'ustaad.standing',
          'ustaad.social',
          'ustaad.feed',
          'ustaad.videoLink',
          'ustaad.home',
          'ustaad.labels',
          'ustaad.media',
          'ustaad.correction',
          'segments',
        ]}
      >
        <MemberGate>
          <ProfileScreen handle={handle} />
        </MemberGate>
      </ClientMessages>
    </div>
  );
}
