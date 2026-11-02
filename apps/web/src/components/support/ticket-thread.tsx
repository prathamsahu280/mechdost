'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { DemoTicket } from '@/demo/support';
import { formatDate } from '@/lib/format';

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
  other: 'kind_other',
} as const;

export function useTicketLabels() {
  const t = useTranslations('support');
  return {
    status: (s: DemoTicket['status']) => t(STATUS_LABEL[s]),
    kind: (k: DemoTicket['kind']) => t(KIND_LABEL[k]),
  };
}

/**
 * One request's messages, oldest first. Customers never see internal notes. Message text is user content
 * (`data-user-content`: kept in the language it was written in, outside the Hindi coverage gate).
 */
export function TicketThread({ ticket, viewer }: { ticket: DemoTicket; viewer: 'customer' | 'staff' }) {
  const t = useTranslations('support');
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
              : m.author
            : viewer === 'customer'
              ? t('you')
              : m.role === 'guest'
                ? t('guest')
                : m.author;
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
          </li>
        );
      })}
    </ol>
  );
}
