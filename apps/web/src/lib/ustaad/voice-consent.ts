import { USTAAD_CORRECTION_MODES } from '@mechdost/shared/ustaad/codes';
import type { ChoicesView } from '@mechdost/shared/ustaad/dto/members';
import type { ApiResult } from '../orders-api';
import { ustaadClient } from './client';

/**
 * The `ustaad_voice` purpose consent (SIM-P10; spec 23 § 13 "asked the first time a member records"; DPDP). The
 * recorder asks once before the first recording; the answer is stored with the member's other choices (append-only
 * `consents`). The API refuses a voice upload without it (403 `USTAAD_VOICE_CONSENT`), so a choices read that fails
 * lets the recorder open and the server stays the boundary.
 */
export function voiceConsentFrom(r: ApiResult<ChoicesView>): { ask: boolean; version: number | null } {
  if (!r.ok) return { ask: false, version: null };
  return { ask: !r.data.consents.ustaad_voice, version: r.data.version };
}

/** G17: the smart-correction modes a member may pick ("Fix by itself" included) when the admin lets them choose. */
export function correctionModeChoices(canChange: boolean): (typeof USTAAD_CORRECTION_MODES)[number][] {
  return canChange ? [...USTAAD_CORRECTION_MODES] : [];
}

let cached: Promise<{ ask: boolean; version: number | null }> | null = null;

/** Whether to ask before recording (one read per page load; a grant clears it). */
export function voiceConsentState(locale: string): Promise<{ ask: boolean; version: number | null }> {
  cached ??= ustaadClient(locale)
    .then(async (c) => voiceConsentFrom(await c.choices()))
    .catch(() => ({ ask: false, version: null }));
  return cached;
}

/** The member allowed voice notes: one consent row, then the recorder opens. */
export async function grantVoiceConsent(locale: string, version: number): Promise<boolean> {
  const r = await (
    await ustaadClient(locale)
  ).saveChoices({
    expectedVersion: version,
    consents: { ustaad_voice: true },
  });
  cached = r.ok ? Promise.resolve({ ask: false, version: r.data.version }) : null;
  return r.ok;
}
