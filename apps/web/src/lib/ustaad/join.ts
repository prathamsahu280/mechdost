/**
 * The 5-step Ustaad join (spec 23 § 4 flow 1, § 4a; plan task B1), pure parts: the draft, per-step checks, the body
 * for `POST /v1/ustaad/join` (exactly the strict shared DTO) and error codes → message keys. Shared by `/ustaad/join`
 * and `/partners/apply/mechanic` (one component). No age field anywhere (founder ruling 2026-11-26). The three
 * optional consents start unticked; the required one too (the person ticks it themselves).
 */
import { PINCODE_RE } from '@mechdost/shared/geo';
import type { USTAAD_JOIN_CONSENTS, UstaadSpecialityCode, UstaadTrack } from '@mechdost/shared/ustaad/codes';
import type { Join } from '@mechdost/shared/ustaad/dto/members';

/**
 * What `/partners/apply/mechanic` shows (spec 23 § 4a, lead 2026-11-26): the Ustaad join only once the network is open
 * to everyone; during `off` and `staff_preview` the old mechanic application stays, with no mention of the network.
 */
export function mechanicApplyView(access: 'off' | 'staff_preview' | 'open'): 'ustaad_join' | 'application' {
  return access === 'open' ? 'ustaad_join' : 'application';
}

export const JOIN_STEPS = ['who', 'work', 'details', 'verify', 'choices'] as const;
export type JoinStep = (typeof JOIN_STEPS)[number];
export type JoinConsent = (typeof USTAAD_JOIN_CONSENTS)[number];
/** Proofs offered at join; the certificate stays "Coming soon" (PENDING #28) and is never sent. */
export type JoinProof = 'owner' | 'vouch';

export interface JoinDraft {
  track: UstaadTrack | null;
  specialities: UstaadSpecialityCode[];
  displayName: string;
  garageName: string;
  showGarage: boolean;
  pincode: string;
  areaLabel: string;
  /** Kept as typed text until submit (an empty box is not 0). */
  yearsClaimed: string;
  workPlace: 'shop' | 'home_roadside' | null;
  verifyMethods: JoinProof[];
  consents: Record<JoinConsent, boolean>;
}

export function emptyJoinDraft(prefill?: { name?: string; pincode?: string }): JoinDraft {
  return {
    track: null,
    specialities: [],
    displayName: prefill?.name ?? '',
    garageName: '',
    showGarage: false,
    pincode: prefill?.pincode ?? '',
    areaLabel: '',
    yearsClaimed: '',
    workPlace: null,
    verifyMethods: [],
    consents: {
      ustaad_profile: false,
      ustaad_directory: false,
      ustaad_training: false,
      ustaad_offers: false,
    },
  };
}

/** Message keys of `ustaad.join` this module returns (typed so `t()` accepts them). */
export type JoinStepErrorKey =
  'errTrack' | 'errWork' | 'errName2' | 'errPincode' | 'errArea' | 'errYears' | 'errWorkPlace' | 'errConsent';
export type JoinApiErrorKey =
  | 'errRegion'
  | 'errName'
  | 'errAlready'
  | 'errInvite'
  | 'errClosed'
  | 'errBanned'
  | 'errTurnstile'
  | 'errPhone'
  | 'errRate'
  | 'errGeneric';

/** Message keys (`ustaad.join.*`) per field for one step; empty = the step may continue. */
export function stepErrors(step: JoinStep, d: JoinDraft): Partial<Record<string, JoinStepErrorKey>> {
  const e: Partial<Record<string, JoinStepErrorKey>> = {};
  switch (step) {
    case 'who':
      if (!d.track) e.track = 'errTrack';
      break;
    case 'work':
      if (d.specialities.length === 0) e.specialities = 'errWork';
      break;
    case 'details': {
      const name = d.displayName.trim();
      if (name.length < 2 || name.length > 60) e.displayName = 'errName2';
      if (!PINCODE_RE.test(d.pincode.trim())) e.pincode = 'errPincode';
      const area = d.areaLabel.trim();
      if (area.length < 2 || area.length > 80) e.areaLabel = 'errArea';
      const years = Number(d.yearsClaimed);
      if (d.yearsClaimed.trim() === '' || !Number.isInteger(years) || years < 0 || years > 60)
        e.yearsClaimed = 'errYears';
      if (!d.workPlace) e.workPlace = 'errWorkPlace';
      break;
    }
    case 'verify':
      break;
    case 'choices':
      if (!d.consents.ustaad_profile) e.ustaad_profile = 'errConsent';
      break;
  }
  return e;
}

export function joinBody(
  d: JoinDraft,
  opts: { turnstileToken: string; via: 'ustaad' | 'partners_apply'; fromApplication?: string },
): Join {
  const garage = d.garageName.trim();
  return {
    track: d.track ?? 'apprentice',
    specialities: [...new Set(d.specialities)],
    displayName: d.displayName.trim(),
    garageName: garage.length >= 2 ? garage : null,
    showGarage: d.showGarage,
    pincode: d.pincode.trim(),
    areaLabel: d.areaLabel.trim(),
    yearsClaimed: Number(d.yearsClaimed),
    workPlace: d.workPlace ?? 'shop',
    verifyMethods: [...new Set(d.verifyMethods)],
    consents: { ...d.consents, ustaad_profile: true },
    turnstileToken: opts.turnstileToken,
    via: opts.via,
    ...(opts.fromApplication ? { fromApplication: opts.fromApplication } : {}),
  };
}

const ERRORS: Partial<Record<string, JoinApiErrorKey>> = {
  USTAAD_REGION: 'errRegion',
  NAME_RESERVED: 'errName',
  USTAAD_ALREADY_MEMBER: 'errAlready',
  USTAAD_INVITE_INVALID: 'errInvite',
  USTAAD_JOIN_CLOSED: 'errClosed',
  USTAAD_BANNED: 'errBanned',
  TURNSTILE_FAILED: 'errTurnstile',
  VERIFICATION_REQUIRED: 'errPhone',
  RATE_LIMITED: 'errRate',
};

export function joinErrorKey(code: string): JoinApiErrorKey {
  return ERRORS[code] ?? 'errGeneric';
}
