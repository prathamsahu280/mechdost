/**
 * Ustaad moderation rules (spec 23 § 13; SR-36, SR-39; plan task F2): the screen normaliser and signals (incl. review
 * focus 5, `scam filter normalises digits`), the hold/block decision with pre-moderation of new accounts' media,
 * clocks per reason and the overdue stages, four-eyes for bans, and the report DTOs.
 */
import { describe, expect, it } from 'vitest';
import { CreateReportDto, ModerationActDto, TakedownDto } from '../src/ustaad/dto/moderation';
import {
  banNeedsFourEyes,
  clockFor,
  maskContactsInText,
  clockMs,
  normaliseForScreen,
  overdueStage,
  phraseHit,
  screenDecision,
  screenTextSignals,
  type ScreenAccount,
} from '../src/ustaad/moderation';

const lists = {
  banned: ['chutiya'],
  scamPhrases: ['registration fee', 'security deposit'],
  linkDomains: ['evil.xyz'],
};
const settled: ScreenAccount = {
  accountAgeDays: 90,
  priorMediaPosts: 10,
  hasMedia: false,
  premodFirstPosts: 3,
  premodAccountDays: 30,
  linksMinAccountDays: 7,
};

describe('normaliser', () => {
  it('NFKC, zero-width and Devanagari digits become plain ASCII', () => {
    expect(normaliseForScreen('ＯＴＰ\u200b  ९८७६५४३२१०')).toBe('otp 9876543210');
  });
  it('phrases match on word edges for Latin text and anywhere for Devanagari', () => {
    expect(phraseHit('pay the security deposit now', 'Security  Deposit')).toBe(true);
    expect(phraseHit('redeposited', 'deposit')).toBe(false);
    expect(phraseHit('यह साइलेंसर काट दो', 'साइलेंसर काट')).toBe(true);
  });
});

describe('signals', () => {
  it('scam filter normalises digits: a phone number in Devanagari digits is still a phone number', () => {
    expect(screenTextSignals('call karo ९८७६५ ४३२१०', lists)).toContain('phone_number');
  });
  it('part numbers and tyre sizes are not phone numbers or plates', () => {
    expect(screenTextSignals('6301 bearing, 175/65 R14, DOT 3', lists)).toEqual([]);
    // Honda-style part numbers look like dashed phone numbers: they only hold (phone_like), never block.
    expect(screenTextSignals('96100-62010-00 lagao', lists)).toEqual(['phone_like']);
    expect(screenTextSignals('94109-12000 washer', lists)).toEqual(['phone_like']);
    expect(screenDecision('post', ['phone_like'], settled).outcome).toBe('hold');
  });
  it('ordinary Hinglish is not a link; a lower-case spaced plate shape only holds (plate_like)', () => {
    expect(screenTextSignals('Splendor ka 97 cc 2018 model', lists)).toEqual(['plate_like']);
    expect(screenDecision('post', ['plate_like'], settled).outcome).toBe('hold');
    expect(screenTextSignals('rs 50 se 2000 tak', lists)).toEqual([]);
    expect(screenTextSignals('thik hai.me kal aaunga', lists)).toEqual([]);
    expect(screenTextSignals('gaadi cg04ab1234 hai', lists)).toContain('number_plate');
  });
  it('security review: phone numbers written with any mix of spaces and dashes are caught and masked', () => {
    expect(screenTextSignals('98 76 54 32 10', lists)).toContain('phone_number');
    expect(screenTextSignals('0 98765 43210', lists)).toContain('phone_number');
    for (const p of ['+91-98765-43210', '9-8-7-6-5-4-3-2-1-0']) {
      const s = screenTextSignals(`call ${p}`, lists);
      expect(
        s.some((x) => x === 'phone_number' || x === 'phone_like'),
        p,
      ).toBe(true);
      expect(maskContactsInText(`call ${p}`), p).not.toMatch(/[0-9]{3}/);
    }
  });
  it('security review: redirector and messaging links count in any spelling; the denylist runs on all text', () => {
    for (const l of [
      't.me/kaam',
      'wa.me/919876543210',
      'bit.ly/x1',
      'tinyurl kaam',
      'goo.gl/x',
      'rb.gy/x',
      'cutt.ly/x',
    ])
      expect(screenTextSignals(`join ${l}`, lists), l).toContain('link');
    expect(screenTextSignals('join t . me/kaam', lists)).toContain('link');
    expect(screenTextSignals('wa dot me pe aao', lists)).toContain('link');
    expect(screenTextSignals('bit (dot) ly/abc', lists)).toContain('link');
    expect(screenTextSignals('visit evil dot xyz for jobs', lists)).toContain('link_denied');
  });
  it('security review: plates with separators in any case', () => {
    expect(screenTextSignals('CG-04-AB-1234', lists)).toContain('number_plate');
    expect(screenTextSignals('gaadi cg 04 ab 1234 hai', lists)).toContain('plate_like');
    expect(screenTextSignals('ka 97 cc 2018', lists)).toContain('plate_like');
  });
  it('UPI ids, pay-app asks, OTP asks and fee phrases are flagged', () => {
    expect(screenTextSignals('paise ramesh@ybl pe bhejo', lists)).toContain('upi_id');
    expect(screenTextSignals('phonepe karo jaldi', lists)).toContain('pay_app');
    expect(screenTextSignals('apna OTP share karo', lists)).toContain('otp_ask');
    expect(screenTextSignals('registration fee 500', lists)).toContain('scam_phrase');
    expect(screenTextSignals('mail me at a.b@gmail.com.', lists)).not.toContain('upi_id');
  });
  it('plates, links, denied domains, banned words and illegal modification', () => {
    expect(screenTextSignals('CG 04 AB 1234 wali gaadi', lists)).toContain('number_plate');
    expect(screenTextSignals('22 BH 1234 AA', lists)).toContain('number_plate');
    expect(screenTextSignals('dekho www.example.com', lists)).toContain('link');
    expect(screenTextSignals('go to evil.xyz/win', lists)).toEqual(
      expect.arrayContaining(['link', 'link_denied']),
    );
    expect(screenTextSignals('tu CHUTIYA hai', lists)).toContain('banned_word');
    expect(screenTextSignals('DPF delete kar denge', lists)).toContain('illegal_modification');
  });
});

describe('decision', () => {
  it('clean text is ok', () => {
    expect(screenDecision('post', [], settled).outcome).toBe('ok');
  });
  it('a phone number blocks public text but holds comments, messages and jobs', () => {
    expect(screenDecision('post', ['phone_number'], settled).outcome).toBe('block');
    expect(screenDecision('answer', ['phone_number'], settled).outcome).toBe('block');
    for (const k of ['comment', 'message', 'job'] as const)
      expect(screenDecision(k, ['phone_number'], settled).outcome).toBe('hold');
  });
  it('a plate blocks public text; a message is not blocked for it', () => {
    expect(screenDecision('question', ['number_plate'], settled).outcome).toBe('block');
    expect(screenDecision('message', ['number_plate'], settled).outcome).toBe('ok');
  });
  it('scam/UPI/OTP patterns hold comments and messages', () => {
    for (const s of ['upi_id', 'otp_ask', 'pay_app', 'scam_phrase'] as const) {
      expect(screenDecision('comment', [s], settled).outcome).toBe('hold');
      expect(screenDecision('message', [s], settled).outcome).toBe('hold');
    }
  });
  it('links: blocked from accounts younger than the setting, always to a denied domain', () => {
    expect(screenDecision('post', ['link'], { ...settled, accountAgeDays: 3 }).outcome).toBe('block');
    expect(screenDecision('post', ['link'], settled).outcome).toBe('ok');
    expect(screenDecision('post', ['link', 'link_denied'], settled).outcome).toBe('block');
  });
  it('pre-moderation of the first 3 media posts and accounts < 30 days; never voice notes on Q&A', () => {
    const media = { ...settled, hasMedia: true };
    expect(screenDecision('post', [], { ...media, priorMediaPosts: 2 }).outcome).toBe('hold');
    expect(screenDecision('post', [], { ...media, accountAgeDays: 29 }).outcome).toBe('hold');
    expect(screenDecision('post', [], media).outcome).toBe('ok');
    expect(screenDecision('question', [], { ...media, accountAgeDays: 1, priorMediaPosts: 0 }).outcome).toBe(
      'ok',
    );
    expect(screenDecision('post', [], { ...media, premodFirstPosts: 0, premodAccountDays: 0 }).outcome).toBe(
      'ok',
    );
  });
});

describe('clocks', () => {
  const s = {
    'ustaad.mod.clock_intimate_h': 2,
    'ustaad.mod.clock_legal_h': 3,
    'ustaad.mod.clock_removal_h': 36,
    'ustaad.mod.clock_standard_h': 24,
    'ustaad.mod.clock_grievance_days': 7,
  };
  it('clocks per reason: 2 h, 3 h, 36 h, 24 h, 7 days', () => {
    expect(clockMs('intimate_2h', s)).toBe(2 * 3_600_000);
    expect(clockMs('legal_3h', s)).toBe(3 * 3_600_000);
    expect(clockMs('removal_36h', s)).toBe(36 * 3_600_000);
    expect(clockMs('standard_24h', s)).toBe(24 * 3_600_000);
    expect(clockMs('grievance_7d', s)).toBe(7 * 86_400_000);
  });
  it('picks the clock by source and reason', () => {
    const base = { reasonDefault: 'standard_24h' as const };
    expect(clockFor({ ...base, source: 'legal_order', reason: 'other' })).toBe('legal_3h');
    expect(clockFor({ ...base, source: 'member', reason: 'ncii_impersonation' })).toBe('intimate_2h');
    expect(clockFor({ ...base, source: 'auto_safety', reason: 'minor' })).toBe('intimate_2h');
    expect(clockFor({ ...base, source: 'grievance', reason: 'other', grievanceClock: 'removal_36h' })).toBe(
      'removal_36h',
    );
    expect(clockFor({ ...base, source: 'grievance', reason: 'other' })).toBe('grievance_7d');
    expect(clockFor({ ...base, source: 'member', reason: 'spam' })).toBe('standard_24h');
  });
  it('overdue stages at 50 % and 100 %', () => {
    const c = new Date('2026-11-26T00:00:00Z');
    const due = new Date('2026-11-26T02:00:00Z');
    expect(overdueStage(c, due, new Date('2026-11-26T00:59:00Z'))).toBe(0);
    expect(overdueStage(c, due, new Date('2026-11-26T01:00:00Z'))).toBe(50);
    expect(overdueStage(c, due, new Date('2026-11-26T02:00:00Z'))).toBe(100);
  });
});

describe('four-eyes and DTOs', () => {
  it('a ban of 7 days or more, or permanent, needs a second staff member', () => {
    expect(banNeedsFourEyes(3, 7)).toBe(false);
    expect(banNeedsFourEyes(7, 7)).toBe(true);
    expect(banNeedsFourEyes(null, 7)).toBe(true);
  });
  it('strict bodies refuse unknown fields', () => {
    const id = '00000000-0000-7000-8000-000000000000';
    expect(CreateReportDto.safeParse({ targetType: 'post', targetId: id, reasonCode: 'spam' }).success).toBe(
      true,
    );
    expect(
      CreateReportDto.safeParse({ targetType: 'post', targetId: id, reasonCode: 'spam', status: 'actioned' })
        .success,
    ).toBe(false);
    expect(
      ModerationActDto.safeParse({ action: 'ban', reasonCode: 'abuse', days: 3, version: 1 }).success,
    ).toBe(true);
    expect(
      TakedownDto.safeParse({
        targetType: 'post',
        targetId: id,
        basis: 'court_order',
        reference: 'W.P. 12/2026',
      }).success,
    ).toBe(true);
  });
});
