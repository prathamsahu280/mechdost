import {
  AdminRefundDto,
  AdminRefundPageDto,
  RefundDestinationDto,
  type AdminRefund,
  type AdminRefundPage,
  type AdminRefundView,
  type RefundDestinationInput,
} from '@mechdost/shared/refunds-api';
import type { RefundRejectReason } from '@mechdost/shared/state';
import { adminApi, type AdminResult } from './admin-api';

/**
 * The finance refund queue on the MechDost API (real sign-in only; spec 05, decision 2026-11-15). Every answer is
 * validated with the shared schemas (hard rule 4); errors come back as the API's code for the screen to translate
 * (`refundErrorKey`). Loaded only by the admin Refunds screen (dynamic import).
 */
export function fetchRefunds(
  locale: string,
  view: AdminRefundView,
  cursor?: string,
): Promise<AdminResult<AdminRefundPage>> {
  const q = new URLSearchParams({ view, limit: '20' });
  if (cursor) q.set('cursor', cursor);
  return adminApi(locale, `/admin/refunds?${q.toString()}`, AdminRefundPageDto);
}

export function fetchRefund(locale: string, id: string): Promise<AdminResult<AdminRefund>> {
  return adminApi(locale, `/admin/refunds/${encodeURIComponent(id)}`, AdminRefundDto);
}

export function approveRefund(
  locale: string,
  id: string,
  version: number,
): Promise<AdminResult<AdminRefund>> {
  return adminApi(locale, `/admin/refunds/${encodeURIComponent(id)}/approve`, AdminRefundDto, {
    method: 'POST',
    body: { version },
  });
}

export function rejectRefund(
  locale: string,
  id: string,
  input: { version: number; reasonCode: RefundRejectReason },
): Promise<AdminResult<AdminRefund>> {
  return adminApi(locale, `/admin/refunds/${encodeURIComponent(id)}/reject`, AdminRefundDto, {
    method: 'POST',
    body: input,
  });
}

export function markRefundPaid(
  locale: string,
  id: string,
  input: { version: number; reference: string },
): Promise<AdminResult<AdminRefund>> {
  return adminApi(locale, `/admin/refunds/${encodeURIComponent(id)}/mark-paid`, AdminRefundDto, {
    method: 'POST',
    body: input,
  });
}

export async function fetchRefundDestination(
  locale: string,
  id: string,
): Promise<AdminResult<RefundDestinationInput>> {
  const res = await adminApi(
    locale,
    `/admin/refunds/${encodeURIComponent(id)}/destination`,
    RefundDestinationDto,
  );
  return res.ok ? { ok: true, data: res.data.destination } : res;
}
