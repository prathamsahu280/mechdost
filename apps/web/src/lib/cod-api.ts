import {
  AdminCodRequestsDto,
  CodDecisionDto,
  CodRequestCreatedDto,
  CodVersionDto,
  MyCodDto,
} from '@mechdost/shared/cod-api';
import type {
  CodDecisionReason,
  CodRequestReason,
  CodRequestState,
  CodRevokeReason,
} from '@mechdost/shared/cod-eligibility';
import { authed } from './orders-api';

/**
 * Cash on delivery on request, real data mode (founder ruling 2026-11-26): the customer's state and requests, and the
 * staff queue. Answers are validated with the shared schemas (hard rule 4). Loaded only when a COD panel opens.
 */
const loc = (locale: string) => (locale === 'hi' ? 'hi' : 'en');

export function fetchMyCod(locale: string, pincode: string) {
  return authed(loc(locale), `/me/cod?pincode=${encodeURIComponent(pincode)}`, MyCodDto);
}

export function sendCodRequest(
  locale: string,
  input: { pincode: string; reasonCode: CodRequestReason; note: string | null },
) {
  return authed(loc(locale), '/me/cod/requests', CodRequestCreatedDto, {
    method: 'POST',
    body: {
      pincode: input.pincode,
      reasonCode: input.reasonCode,
      ...(input.note ? { note: input.note } : {}),
    },
  });
}

export function withdrawCodRequest(locale: string, id: string, version: number) {
  return authed(loc(locale), `/me/cod/requests/${encodeURIComponent(id)}/withdraw`, CodVersionDto, {
    method: 'POST',
    body: { version },
  });
}

export function fetchCodQueue(locale: string, status: CodRequestState, cursor: string | null) {
  const q = new URLSearchParams({ status, limit: '25', ...(cursor ? { cursor } : {}) });
  return authed(loc(locale), `/admin/cod-requests?${q.toString()}`, AdminCodRequestsDto);
}

export type CodDecision =
  | { kind: 'approve'; capPaise: number | null; expiresAt: string | null }
  | { kind: 'reject'; reasonCode: CodDecisionReason }
  | { kind: 'revoke'; reasonCode: CodRevokeReason };

export function decideCod(locale: string, id: string, version: number, d: CodDecision) {
  const body =
    d.kind === 'approve'
      ? {
          version,
          ...(d.capPaise !== null ? { capPaise: d.capPaise } : {}),
          ...(d.expiresAt ? { expiresAt: d.expiresAt } : {}),
        }
      : { version, reasonCode: d.reasonCode };
  return authed(loc(locale), `/admin/cod-requests/${encodeURIComponent(id)}/${d.kind}`, CodDecisionDto, {
    method: 'POST',
    body,
  });
}
