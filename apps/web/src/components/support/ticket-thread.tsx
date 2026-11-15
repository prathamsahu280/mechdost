'use client';

import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import type { TicketStatus } from '@mechdost/shared/state';
import type { SupportTicketKind } from '@mechdost/shared/support-api';
import { formatDate } from '@/lib/format';
import { photoSrc } from '@/lib/photo-src';

const STATUS_LABEL = {
  open: 'status_open',
  in_review: 'status_in_review',
  awaiting_customer: 'status_awaiting_customer',
  resolved: 'status_resolved',
  closed: 'status_closed',
} as const;

const KIND_LABEL = {
  order_issue: 'kind_order_issue',
  refund: 'kind_refund',
  fitment: 'kind_fitment',
  account: 'kind_account',
  labour_redo: 'kind_labour_redo',
  deletion_request: 'kind_deletion_request',
  other: 'kind_other',
} as const;

export function useTicketLabels() {
  const t = useTranslations('support');
  return {
    status: (s: TicketStatus) => t(STATUS_LABEL[s]),
    kind: (k: SupportTicketKind) => t(KIND_LABEL[k]),
  };
}

/** One message as the thread shows it: the demo store's messages, or the API's mapped by `threadFromApi`. */
export interface ThreadMessage {
  id: string;
  role: string;
  /** Who wrote it (demo store); the API does not expose staff or customer names, so it is absent there. */
  author?: string;
  body: string;
  internal: boolean;
  channel: string;
  at: string;
  /** Photos sent with the message (real mode): short-lived URLs from the API, shown as thumbnails that open the large copy. */
  attachments?: readonly { id: string; width: number; height: number; thumbUrl: string; largeUrl: string }[];
}

/**
 * One request's messages, oldest first. Customers never see internal notes. Message text is user content
 * (`data-user-content`: kept in the language it was written in, outside the Hindi coverage gate).
 */
export function TicketThread({
  ticket,
  viewer,
}: {
  ticket: { messages: readonly ThreadMessage[] };
  viewer: 'customer' | 'staff';
}) {
  const t = useTranslations('support');
  const tt = useTranslations('supportThread');
  const locale = useLocale();
  const messages = ticket.messages.filter((m) => viewer === 'staff' || !m.internal);
  return (
    <ol className="space-y-3">
      {messages.map((m) => {
        const mine = viewer === 'customer' ? m.role === 'customer' : m.role === 'staff';
        const who =
          m.role === 'staff'
            ? viewer === 'customer'
              ? t('fromStaff')
              : (m.author ?? t('fromStaff'))
            : viewer === 'customer'
              ? t('you')
              : m.role === 'guest'
                ? t('guest')
                : (m.author ?? t('api_customer'));
        return (
          <li
            key={m.id}
            className={`max-w-[85%] rounded-card border p-3 text-sm ${
              m.internal
                ? 'border-warning-line bg-warning-bg'
                : mine
                  ? 'ml-auto border-line-card bg-accent-soft'
                  : 'border-line-card bg-surface-alt'
            }`}
          >
            <p className="text-xs font-bold text-muted">
              {who}
              {m.internal ? ` · ${t('internalBadge')}` : null}
              {m.channel === 'whatsapp' ? ` · ${t('viaWhatsApp')}` : null}
              {' · '}
              <time dateTime={m.at}>{formatDate(m.at, locale)}</time>
            </p>
            <p data-user-content className="mt-1 whitespace-pre-line text-ink">
              {m.body}
            </p>
            {m.attachments?.length ? (
              <ul aria-label={tt('attachmentsLabel')} className="mt-2 flex flex-wrap gap-2">
                {m.attachments.map((a, i) => (
                  <li key={a.id}>
                    <a
                      href={photoSrc(a.largeUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="relative block size-20 overflow-hidden rounded-lg border border-line-card bg-pill focus-visible:outline-2 focus-visible:outline-offset-2"
                    >
                      <Image
                        src={photoSrc(a.thumbUrl)}
                        alt={tt('attachmentAlt', { n: i + 1, total: m.attachments?.length ?? 0 })}
                        fill
                        sizes="80px"
                        unoptimized
                        className="object-cover"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
