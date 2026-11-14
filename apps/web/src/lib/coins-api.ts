import { CoinLedgerDto, MyCoinsDto, type CoinLedgerPage, type MyCoinsView } from '@mechdost/shared/coins-api';
import { authed, type ApiResult } from './orders-api';

/**
 * The signed-in customer's MechDost Coins on the API (spec 20): balance, coins on the way, the next expiry, the rules
 * and the history. Loaded only by the real-mode coin screens and the checkout (lazy imports), never by the demo.
 */
export function fetchMyCoins(locale: string): Promise<ApiResult<MyCoinsView>> {
  return authed(locale, '/me/coins', MyCoinsDto);
}

export function fetchMyCoinLedger(
  locale: string,
  cursor?: string | null,
): Promise<ApiResult<CoinLedgerPage>> {
  const q = new URLSearchParams({ limit: '20' });
  if (cursor) q.set('cursor', cursor);
  return authed(locale, `/me/coins/ledger?${q.toString()}`, CoinLedgerDto);
}
