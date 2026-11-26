import { COD_REQUEST_STATES } from '../cod-eligibility';
import { defineMachine } from './machine';

/**
 * A customer's request for cash on delivery (founder ruling 2026-11-26; spec 03 § Cash-on-delivery eligibility).
 * One pending request per customer (partial unique index). Staff approve (optionally with a personal cap and an end
 * date) or reject with a reason code; an approval can be revoked later with a reason, or runs out (`expired`, set
 * by the system when its end date has passed and a new decision replaces it). History is never deleted.
 */
export const codRequestMachine = /* @__PURE__ */ defineMachine(
  'cod_request',
  COD_REQUEST_STATES,
  ['rejected', 'withdrawn', 'revoked', 'expired'],
  [
    { from: 'pending', to: 'approved', by: ['admin'] },
    { from: 'pending', to: 'rejected', by: ['admin'] },
    { from: 'pending', to: 'withdrawn', by: ['customer'] },
    { from: 'approved', to: 'revoked', by: ['admin'] },
    { from: 'approved', to: 'expired', by: ['system'] },
  ],
);
