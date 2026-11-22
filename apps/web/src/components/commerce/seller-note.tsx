'use client';

import { useIsSeller } from '@/demo/session-state';

/**
 * "Seller accounts can't place orders. Sign in with a customer account to buy." Shown only to a signed-in shop
 * account, in the place of the buying actions (product page, cart, checkout); nothing for everyone else. The text
 * arrives translated from the server (no i18n runtime here).
 */
export function SellerNote({ text, className = '' }: { text: string; className?: string }) {
  if (!useIsSeller()) return null;
  return (
    <p
      role="note"
      className={`rounded-card border border-warning-line bg-warning-bg p-4 text-sm font-bold text-warning ${className}`}
    >
      {text}
    </p>
  );
}
