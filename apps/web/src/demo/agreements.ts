'use client';

import { useSyncExternalStore } from 'react';

/**
 * Seller agreement (user 2026-11-13: "an end to end agreement with MechDost", text to follow, Q77). The admin
 * publishes numbered versions in English and Hindi; a shop accepts the current version only; a new version asks
 * every shop again. Mirrors `packages/db/src/repo/agreements.ts` (append-only `shop_agreements`). Demo store
 * until the portals call `/v1/admin/agreements` and `/v1/shop-onboarding/{shopId}/agreement` (data switch).
 */
export interface DemoAgreement {
  version: number;
  textEn: string;
  textHi: string;
  publishedAt: string;
}

interface Acceptance {
  shopSlug: string;
  version: number;
  acceptedAt: string;
}

export type AgreementStatus =
  | { status: 'none' }
  | { status: 'to_accept'; version: number }
  | { status: 'accepted'; version: number; acceptedAt: string };

const VERSIONS_KEY = 'mechdost-demo-agreements';
const ACCEPTED_KEY = 'mechdost-demo-agreement-acceptances';
const TEXT_MIN = 20;
const TEXT_MAX = 50_000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isVersion = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;

function isAgreement(v: unknown): v is DemoAgreement {
  return (
    isRecord(v) &&
    isVersion(v.version) &&
    typeof v.textEn === 'string' &&
    typeof v.textHi === 'string' &&
    typeof v.publishedAt === 'string'
  );
}

function isAcceptance(v: unknown): v is Acceptance {
  return (
    isRecord(v) && typeof v.shopSlug === 'string' && isVersion(v.version) && typeof v.acceptedAt === 'string'
  );
}

function read<T>(key: string, guard: (v: unknown) => v is T): T[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(guard) : [];
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();
let version = 0;

function write(key: string, value: readonly unknown[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the demo keeps working for this page view.
  }
  version += 1;
  for (const l of listeners) l();
}

const versions = () => read(VERSIONS_KEY, isAgreement);
const acceptances = () => read(ACCEPTED_KEY, isAcceptance);
const validText = (s: string) => s.length >= TEXT_MIN && s.length <= TEXT_MAX;

export function publishAgreement(input: {
  textEn: string;
  textHi: string;
}): { version: number } | { error: 'AGREEMENT_TEXT_INVALID' } {
  const textEn = input.textEn.trim();
  const textHi = input.textHi.trim();
  if (!validText(textEn) || !validText(textHi)) return { error: 'AGREEMENT_TEXT_INVALID' };
  const all = versions();
  const next = Math.max(0, ...all.map((a) => a.version)) + 1;
  write(VERSIONS_KEY, [...all, { version: next, textEn, textHi, publishedAt: new Date().toISOString() }]);
  return { version: next };
}

export function currentAgreement(): DemoAgreement | null {
  return versions().reduce<DemoAgreement | null>(
    (best, a) => (!best || a.version > best.version ? a : best),
    null,
  );
}

/** Accept the version the shop read; false when a newer version was published meanwhile. */
export function acceptAgreement(shopSlug: string, agreementVersion: number): boolean {
  const current = currentAgreement();
  if (current?.version !== agreementVersion) return false;
  const all = acceptances();
  if (all.some((a) => a.shopSlug === shopSlug && a.version === agreementVersion)) return true;
  write(ACCEPTED_KEY, [
    ...all,
    { shopSlug, version: agreementVersion, acceptedAt: new Date().toISOString() },
  ]);
  return true;
}

export function shopAgreementStatus(shopSlug: string): AgreementStatus {
  const current = currentAgreement();
  if (!current) return { status: 'none' };
  const accepted = acceptances().find((a) => a.shopSlug === shopSlug && a.version === current.version);
  return accepted
    ? { status: 'accepted', version: current.version, acceptedAt: accepted.acceptedAt }
    : { status: 'to_accept', version: current.version };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === VERSIONS_KEY || e.key === ACCEPTED_KEY) {
      version += 1;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Re-renders when an agreement is published or accepted (this tab or another). */
export function useAgreementsVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  );
}
