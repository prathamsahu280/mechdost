/**
 * Demo partner applications, seller invites and customer reviews in the browser store, split from `store.ts` so
 * storefront pages do not load this code (JS budget, spec 16). Same storage and listeners (`storeCore`).
 */
import { publicCode } from '@mechdost/shared/ids';
import { APPLICATION_REJECT_REASONS, type ApplicationRejectReason } from '@mechdost/shared/partner-codes';
import { OPERATIONAL_SETTINGS } from '@mechdost/shared/settings';
import { useSyncExternalStore } from 'react';
import {
  APPLICATION_STAGES,
  storeCore,
  type Coverage,
  type DemoApplication,
  type DemoInvite,
  type DemoReview,
  type ReviewStatus,
} from './store';
import { PIN_CENTROIDS } from './workshops';

const {
  keys: KEYS,
  read,
  write,
  subscribe,
  serverSnapshot,
  isRecord,
  applicationsSnapshot,
  newId,
} = storeCore;

const isReview = (v: unknown): v is DemoReview =>
  isRecord(v) && typeof v.id === 'string' && typeof v.rating === 'number';
const isInvite = (v: unknown): v is DemoInvite =>
  isRecord(v) && typeof v.token === 'string' && typeof v.phone === 'string' && typeof v.status === 'string';
const reviewsSnapshot = () => read(KEYS.reviews, isReview);
const invitesSnapshot = () => read(KEYS.invites, isInvite);

export function useApplications(): readonly DemoApplication[] {
  return useSyncExternalStore(subscribe, applicationsSnapshot, serverSnapshot);
}

export function useReviews(): readonly DemoReview[] {
  return useSyncExternalStore(subscribe, reviewsSnapshot, serverSnapshot);
}

export function useInvites(): readonly DemoInvite[] {
  return useSyncExternalStore(subscribe, invitesSnapshot, serverSnapshot);
}

/** Admin (demo): invite a seller. Returns the one-time token for the link. */
export function createInvite(input: { name: string; email: string; phone: string }): DemoInvite {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const now = new Date();
  const invite: DemoInvite = {
    ...input,
    token,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
    status: 'sent',
  };
  write(
    KEYS.invites,
    [invite, ...invitesSnapshot().filter((i) => !(i.phone === input.phone && i.status === 'sent'))].slice(
      0,
      200,
    ),
  );
  return invite;
}

/** The invite behind a link, or why it cannot be used. */
export function findInvite(token: string): DemoInvite | 'used' | 'expired' | 'revoked' | null {
  const invite = invitesSnapshot().find((i) => i.token === token);
  if (!invite) return null;
  if (invite.status === 'used' || invite.status === 'revoked') return invite.status;
  if (Date.parse(invite.expiresAt) <= Date.now()) return 'expired';
  return invite;
}

export function revokeInvite(token: string) {
  write(
    KEYS.invites,
    invitesSnapshot().map((i) =>
      i.token === token && i.status === 'sent' ? { ...i, status: 'revoked' as const } : i,
    ),
  );
}

export function createApplication(
  input: Omit<DemoApplication, 'code' | 'createdAt' | 'stage' | 'rejected'>,
  inviteToken?: string,
): DemoApplication {
  const app: DemoApplication = {
    ...input,
    code: publicCode('PA', 'RPR'),
    createdAt: new Date().toISOString(),
    // An invited seller is pre-approved by the inviting admin, with the city's default delivery area, which the
    // admin can edit later (design 2026-11-13; the API uses `defaultCoverage` the same way).
    stage: inviteToken ? APPLICATION_STAGES.indexOf('onboarded') : 0,
    rejected: false,
    ...(inviteToken ? { coverage: defaultCoverage() } : {}),
  };
  if (inviteToken)
    write(
      KEYS.invites,
      invitesSnapshot().map((i) => (i.token === inviteToken ? { ...i, status: 'used' as const } : i)),
    );
  write(KEYS.applications, [app, ...applicationsSnapshot()].slice(0, 100));
  return app;
}

/** The city's PIN codes with the standard charge and days (settings `partners.default_*`). */
export function defaultCoverage(): Coverage {
  return {
    pincodes: Object.keys(PIN_CENTROIDS),
    shippingPaise: OPERATIONAL_SETTINGS['partners.default_shipping_paise'].default,
    leadDays: OPERATIONAL_SETTINGS['partners.default_lead_days'].default,
  };
}

const ONBOARDED_STAGE = APPLICATION_STAGES.indexOf('onboarded');

function validCoverage(c: Coverage): boolean {
  const ship = OPERATIONAL_SETTINGS['partners.default_shipping_paise'];
  const days = OPERATIONAL_SETTINGS['partners.default_lead_days'];
  return (
    c.pincodes.length > 0 &&
    c.pincodes.every((p) => /^\d{6}$/.test(p)) &&
    Number.isSafeInteger(c.shippingPaise) &&
    c.shippingPaise >= ship.min &&
    c.shippingPaise <= ship.max &&
    Number.isSafeInteger(c.leadDays) &&
    c.leadDays >= days.min &&
    c.leadDays <= days.max
  );
}

/** Admin: approve an open application with its delivery area. False if invalid or already decided. */
export function approveApplication(code: string, coverage: Coverage): boolean {
  if (!validCoverage(coverage)) return false;
  return decideOpenApplication(code, (a) => ({
    ...a,
    stage: ONBOARDED_STAGE,
    coverage: { ...coverage, pincodes: [...new Set(coverage.pincodes)] },
  }));
}

/** Admin: reject an open application with a reason code. */
export function rejectApplication(code: string, reason: ApplicationRejectReason): boolean {
  if (!APPLICATION_REJECT_REASONS.includes(reason)) return false;
  return decideOpenApplication(code, (a) => ({ ...a, rejected: true, rejectReason: reason }));
}

function decideOpenApplication(code: string, decide: (a: DemoApplication) => DemoApplication): boolean {
  const all = applicationsSnapshot();
  const open = all.find((a) => a.code === code && !a.rejected && a.stage < ONBOARDED_STAGE);
  if (!open) return false;
  write(
    KEYS.applications,
    all.map((a) => (a === open ? decide(a) : a)),
  );
  return true;
}

/** Other open (not rejected) applications with the same GST number: a likely duplicate. */
export function applicationsWithSameGstin(app: DemoApplication): DemoApplication[] {
  if (!app.gstNumber) return [];
  return applicationsSnapshot().filter(
    (a) => a.code !== app.code && !a.rejected && a.gstNumber === app.gstNumber,
  );
}

/** Admin action (demo): move an application forward, or reject it. */
export function updateApplication(code: string, change: { stage?: number; rejected?: boolean }) {
  write(
    KEYS.applications,
    applicationsSnapshot().map((a) =>
      a.code === code
        ? {
            ...a,
            stage: Math.min(change.stage ?? a.stage, APPLICATION_STAGES.length - 1),
            rejected: change.rejected ?? a.rejected,
          }
        : a,
    ),
  );
}

/** Customer review: starts `pending`; only admin-approved reviews are published (decision 2026-10-31). */
export function submitReview(input: Omit<DemoReview, 'id' | 'createdAt' | 'status'>): DemoReview {
  const review: DemoReview = {
    ...input,
    rating: Math.min(5, Math.max(1, Math.round(input.rating))),
    id: newId(),
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  write(KEYS.reviews, [review, ...reviewsSnapshot()].slice(0, 200));
  return review;
}

export function moderateReview(id: string, status: ReviewStatus) {
  write(
    KEYS.reviews,
    reviewsSnapshot().map((r) => (r.id === id ? { ...r, status } : r)),
  );
}
