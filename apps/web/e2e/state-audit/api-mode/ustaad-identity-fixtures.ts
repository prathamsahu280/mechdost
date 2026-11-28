/**
 * Typed fixtures of the Mechanic Network join, first-time guide, garage-owner confirm and partner-status screens
 * (spec 23 § 21i-L, batch I) for the API-mode audit. Every body carries the shared schema the screen parses with, so a
 * fixture that drifts from the API contract fails the case (hard rule 4). Sample names only; no phone numbers.
 *
 * Row states: Join `step=1..5`, `form=clean|errors` (the page set-up in `hooks.ts` fills the earlier steps and presses
 * Next); Welcome `tutorial=first|middle|last|no-recording|error` (the set-up presses Next to the card);
 * Attest `attest=loading|gone|ask|confirm-errors|location-denied|decline|done` (the set-up opens the form, and for
 * `done` answers the security check with a stub); Partner status `verify=none|asked|proof|review|verified|rejected`;
 * `stress=long-text` for long en and hi names. Nothing here keeps state between calls: the answer is built from the
 * case and the request.
 */
import { MemberViewDto } from '@mechdost/shared/ustaad/dto/members';
import {
  AttestOutcomeDto,
  AttestPageDto,
  AttestSubmitDto,
  OnboardingViewDto,
  TutorialDto,
  VerificationStatusDto,
} from '@mechdost/shared/ustaad/dto/verification';
import type { AuditCase } from '../cases.ts';
import type { Mock, Reply } from './mock-api.ts';
import { mediaMocks } from './ustaad-social-fixtures.ts';
import {
  failed,
  get,
  iso,
  LONG_EN,
  LONG_HI,
  long,
  MEMBER,
  type Out,
  uuid,
} from './ustaad-member-fixtures.ts';

// ── Join ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The join is only sent from step 5 with a real security check, which a shot never gets; the answer is the card. */
export const ustaadJoinMocks = (): Mock[] => [
  {
    method: 'POST',
    path: /^\/ustaad\/join$/,
    schema: MemberViewDto,
    reply: (): Reply => ({ body: MEMBER satisfies Out<typeof MemberViewDto> }),
  },
];

// ── Welcome (first-time guide) ────────────────────────────────────────────────────────────────────────────────

type Pair = readonly [title: string, body: string];
const CARDS: readonly { code: string; en: Pair; hi: Pair }[] = [
  {
    code: 'ask',
    en: ['Ask by voice', 'Press the mic and say what is wrong. Other mechanics answer.'],
    hi: ['बोलकर पूछें', 'माइक दबाएँ और बताएँ क्या खराबी है। दूसरे मैकेनिक जवाब देंगे।'],
  },
  {
    code: 'show_work',
    en: ['Show your work', 'Post a photo or a short video of a job you finished.'],
    hi: ['अपना काम दिखाएँ', 'किए हुए काम की फोटो या छोटा वीडियो डालें।'],
  },
  {
    code: 'answer',
    en: ['Answer and be known', 'Helpful answers raise your Izzat and your level.'],
    hi: ['जवाब दें, पहचान बनाएँ', 'काम के जवाब से आपकी इज़्ज़त और स्तर बढ़ते हैं।'],
  },
  {
    code: 'levels',
    en: ['Levels and badges', 'Grow from Chhotu to Master Ustaad, one step at a time.'],
    hi: ['स्तर और बैज', 'छोटू से मास्टर उस्ताद तक, एक-एक कदम।'],
  },
  {
    code: 'pin',
    en: ['Put your shop on the map', 'Add your pin so customers nearby can find you.'],
    hi: ['दुकान नक्शे पर डालें', 'अपना पिन लगाएँ ताकि पास के ग्राहक आपको ढूँढ सकें।'],
  },
  {
    code: 'dukaan',
    en: ['Your Dukaan', 'A page for your garage with your best work.'],
    hi: ['आपकी दुकान', 'आपके गैराज का पन्ना, आपके सबसे अच्छे काम के साथ।'],
  },
];

function tutorial(c: AuditCase, lang: string): Out<typeof TutorialDto> {
  const recorded = c.state.tutorial !== 'no-recording';
  return {
    cards: CARDS.map((card, n) => {
      const [title, body] = lang === 'en' ? card.en : card.hi;
      return {
        code: card.code,
        position: n + 1,
        title: long(c) && n === 0 ? `${title}: ${lang === 'en' ? LONG_EN : LONG_HI}` : title,
        body,
        imageMediaId: null,
        audioMediaId: recorded ? uuid(2100 + n) : null,
      };
    }),
    coachmarks: [],
  };
}

export const ustaadWelcomeMocks = (): Mock[] => [
  ...mediaMocks(),
  get(/^\/ustaad\/tutorial$/, TutorialDto, (c, q) =>
    c.state.tutorial === 'error' ? failed() : { body: tutorial(c, q.get('lang') === 'hi' ? 'hi' : 'en') },
  ),
  {
    method: 'PUT',
    path: /^\/ustaad\/onboarding$/,
    schema: OnboardingViewDto,
    reply: (): Reply => ({
      body: {
        lastCard: 1,
        completed: false,
        skipped: false,
        coachmarksSeen: [],
      } satisfies Out<typeof OnboardingViewDto>,
    }),
  },
];

// ── Attest (the garage owner's page) ──────────────────────────────────────────────────────────────────────────

const attestPage = (c: AuditCase): Out<typeof AttestPageDto> => ({
  memberName: long(c) ? `Ramesh Sahu ${LONG_EN}` : 'Ramesh Sahu',
  areaLabel: long(c) ? `Telibandha ${LONG_EN}` : 'Telibandha',
  areaLabelHi: long(c) ? `तेलीबांधा ${LONG_HI}` : 'तेलीबांधा',
  sinceYear: 2019,
  expiresAt: iso(-60 * 24 * 5),
});

export const ustaadAttestMocks = (): Mock[] => [
  {
    method: 'GET',
    path: /^\/ustaad-attest\/[^/]+$/,
    schema: AttestPageDto,
    reply: ({ c }): Reply => {
      // One message for an unknown, used or expired link (the API answers all three the same way).
      if (c.state.attest === 'gone') return { status: 404, code: 'NOT_FOUND' };
      const body = attestPage(c);
      return c.state.attest === 'loading' ? { body, delayMs: 15_000 } : { body };
    },
  },
  {
    method: 'POST',
    path: /^\/ustaad-attest\/[^/]+$/,
    schema: AttestOutcomeDto,
    reply: ({ body }): Reply => {
      const sent = AttestSubmitDto.safeParse(body);
      if (!sent.success) return { status: 400, code: 'VALIDATION' };
      return {
        body: {
          outcome: sent.data.decision === 'confirmed' ? 'received' : 'declined',
        } satisfies Out<typeof AttestOutcomeDto>,
      };
    },
  },
];

// ── Partner status (the member's verification progress) ───────────────────────────────────────────────────────

type Verification = NonNullable<Out<typeof VerificationStatusDto>['verification']>;

const VERIFY: Record<string, Partial<Verification>> = {
  asked: { status: 'requested', attestation: 'requested', vouchesGiven: 0 },
  proof: { status: 'requested', attestation: 'confirmed', vouchesGiven: 1 },
  review: { status: 'in_review', attestation: 'confirmed', vouchesGiven: 2 },
  verified: { status: 'approved', grantedLevel: 'naya', attestation: 'confirmed', vouchesGiven: 2 },
  rejected: { status: 'rejected', reasonCode: 'proofs_mismatch', attestation: 'declined', vouchesGiven: 0 },
};

function verification(c: AuditCase): Out<typeof VerificationStatusDto> {
  const over = VERIFY[String(c.state.verify)];
  if (!over) return { verification: null };
  return {
    verification: {
      id: uuid(2200),
      memberId: MEMBER.id,
      requestedLevel: 'naya',
      grantedLevel: null,
      status: 'requested',
      proofKinds: ['owner', 'vouch'],
      reasonCode: null,
      attestation: null,
      vouchesGiven: 0,
      vouchesNeeded: 2,
      createdAt: iso(60 * 24 * 3),
      decidedAt: over.status === 'approved' || over.status === 'rejected' ? iso(60) : null,
      version: 1,
      ...over,
    },
  };
}

export const ustaadPartnersStatusMocks = (): Mock[] => [
  get(/^\/ustaad\/verification-status$/, VerificationStatusDto, (c) => ({ body: verification(c) })),
];
