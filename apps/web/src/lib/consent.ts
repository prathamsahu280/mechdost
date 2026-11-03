'use client';

import { useSyncExternalStore } from 'react';

/**
 * Consent for non-essential processing (DPDP; decision 2026-10-31 "cookie banner declines non-essential by
 * default"; docs/conventions/data-for-ml.md §8). Only one optional purpose on the web today: `analytics`
 * (page views and clicks sent to `POST /v1/events`). Until the visitor chooses, nothing is sent and no visitor
 * id is created. A new `CONSENT_VERSION` (changed notice) asks again. Stored on this device only; signed-in
 * choices also go to the `consents` table once web sign-in exists.
 */
export const CONSENT_KEY = 'mechdost-consent';
export const CONSENT_VERSION = '2026-11';
const OPEN_EVENT = 'mechdost:consent-open';
const CHANGE_EVENT = 'mechdost:consent-change';

export interface ConsentChoice {
  analytics: boolean;
  version: string;
  at: string;
}

function read(): ConsentChoice | null {
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ConsentChoice>;
    return typeof v.analytics === 'boolean' && v.version === CONSENT_VERSION && typeof v.at === 'string'
      ? { analytics: v.analytics, version: v.version, at: v.at }
      : null;
  } catch {
    return null;
  }
}

let cached: { raw: string | null; value: ConsentChoice | null } = { raw: null, value: null };

/** Current choice for this notice version, or null when the visitor has not chosen. */
export function consentChoice(): ConsentChoice | null {
  if (typeof window === 'undefined') return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
  if (raw !== cached.raw) cached = { raw, value: read() };
  return cached.value;
}

export function analyticsAllowed(): boolean {
  return consentChoice()?.analytics === true;
}

export function saveConsent(analytics: boolean): void {
  const choice: ConsentChoice = { analytics, version: CONSENT_VERSION, at: new Date().toISOString() };
  try {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify(choice));
  } catch {
    // Storage blocked: the choice holds for this page only.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: choice }));
}

/** Reopen the banner ("Privacy choices" in the footer). */
export function openConsentChoices(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function useConsent(): ConsentChoice | null {
  return useSyncExternalStore(subscribe, consentChoice, () => null);
}

export function onConsentOpen(handler: () => void): () => void {
  window.addEventListener(OPEN_EVENT, handler);
  return () => {
    window.removeEventListener(OPEN_EVENT, handler);
  };
}

export function onConsentChange(handler: (choice: ConsentChoice) => void): () => void {
  const listener = (e: Event) => {
    if (e instanceof CustomEvent) handler(e.detail as ConsentChoice);
  };
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}
