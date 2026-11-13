'use client';

import { useTranslations } from 'next-intl';

/** "GST invoice for {business} ({GSTIN})" on an order with a business purchase (buyer GSTIN plan). */
export function GstInvoiceLine({
  business,
  className = 'mt-1 text-sm font-bold text-ink',
}: {
  business: { gstin: string; businessName: string } | null | undefined;
  className?: string;
}) {
  // `order` is loaded on the order page, the shop portal and the admin console.
  const t = useTranslations('order');
  if (!business) return null;
  return (
    <p className={className}>
      {t.rich('gstInvoiceFor', {
        business: business.businessName,
        gstin: business.gstin,
        // The business name is what the customer typed (Hindi gate: user text may stay in Latin script).
        name: (chunks) => <span data-user-content>{chunks}</span>,
      })}
    </p>
  );
}
