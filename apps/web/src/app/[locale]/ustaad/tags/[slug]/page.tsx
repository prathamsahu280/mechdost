import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TAG_SLUG_RE } from '@mechdost/shared/ustaad/dto/feed';
import { ClientMessages } from '@/components/ui/client-messages';
import { MemberGate } from '@/components/ustaad/common';
import { TagScreen } from '@/components/ustaad/feed/feed-screens';

export const metadata: Metadata = { robots: { index: false, follow: false } };

interface Props {
  params: Promise<{ slug: string }>;
}

/** `/ustaad/tags/[slug]` (spec 23 § 5): a curated tag, follow it, its posts. Unknown shapes 404 before any request. */
export default async function UstaadTagPage({ params }: Props) {
  const { slug } = await params;
  if (!TAG_SLUG_RE.test(slug)) notFound();
  return (
    <div className="mx-auto grid max-w-2xl gap-4">
      <ClientMessages
        namespaces={[
          'ustaad.shell',
          'ustaad.standing',
          'ustaad.feed',
          'ustaad.labels',
          'ustaad.media',
          'ustaad.correction',
          'segments',
        ]}
      >
        <MemberGate>
          <TagScreen slug={slug} />
        </MemberGate>
      </ClientMessages>
    </div>
  );
}
