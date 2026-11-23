import { MyRefundPageDto, type MyRefundPage } from '@mechdost/shared/refunds-api';
import { authed, type ApiResult } from './orders-api';

/** The signed-in customer's own refunds (spec 05, `GET /v1/me/refunds`), newest first, one page at a time. */
export function fetchMyRefunds(locale: string, cursor?: string): Promise<ApiResult<MyRefundPage>> {
  const q = new URLSearchParams({ limit: '10' });
  if (cursor) q.set('cursor', cursor);
  return authed(locale, `/me/refunds?${q.toString()}`, MyRefundPageDto);
}
