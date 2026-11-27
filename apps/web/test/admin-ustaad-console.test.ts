/**
 * Admin → Ustaad community console (spec 23 § 3, § 13; task G2): which sections and actions a caller sees (hidden
 * when the API would refuse; the API still checks), the clock badge (time left in words, amber under half the clock,
 * red when overdue), four-eyes in the UI (the proposer never confirms their own ban, the decider never decides the
 * appeal), the levels a reviewer may grant, the section parameter (`?section=verify` from Partners), and every text key
 * the console uses exists in English and Hindi.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { REPORT_REASONS, REPORT_TARGETS, USTAAD_UNBAN_REASONS } from '@mechdost/shared/ustaad/codes';
import { USTAAD_VERIFY_REJECT_REASONS } from '@mechdost/shared/ustaad/codes';
import {
  MODERATION_DECISIONS,
  TAKEDOWN_BASES,
  DM_READ_REASONS,
} from '@mechdost/shared/ustaad/dto/moderation';
import {
  CONSOLE_SECTIONS,
  canConfirmBan,
  canDecideAppeal,
  clockBadge,
  consoleSectionsFor,
  decisionsFor,
  grantableLevels,
  parseConsoleSection,
  type ConsoleCapsView,
} from '../src/lib/admin-ustaad-console';

const cm: ConsoleCapsView = {
  read: true,
  moderate: true,
  verify: true,
  takedown: true,
  settings: false,
  cities: ['RPR'],
};
const ops: ConsoleCapsView = { ...cm, moderate: false, verify: false, takedown: false };
const marketing: ConsoleCapsView = { ...ops, read: false };

describe('sections per capability', () => {
  it('a community manager sees every community section; settings read-only through the settings group', () => {
    expect(consoleSectionsFor(cm)).toEqual(CONSOLE_SECTIONS);
  });
  it('ops (read only) see the queues and members but not Verify or Legal', () => {
    const s = consoleSectionsFor(ops);
    expect(s).toContain('queue');
    expect(s).toContain('members');
    expect(s).not.toContain('verify');
    expect(s).not.toContain('legal');
  });
  it('without any read permission only the own audit trail is left', () => {
    expect(consoleSectionsFor(marketing)).toEqual(['audit']);
  });
  it('?section=verify (Partners link) opens Verify; unknown or hidden sections fall back to the first allowed', () => {
    expect(parseConsoleSection('verify', cm)).toBe('verify');
    expect(parseConsoleSection('verify', ops)).toBe('queue');
    expect(parseConsoleSection('nope', cm)).toBe('queue');
    expect(parseConsoleSection(null, marketing)).toBe('audit');
    expect(parseConsoleSection('settings', cm)).toBe('settings');
  });
});

describe('clock badge', () => {
  const created = new Date('2026-11-26T00:00:00Z');
  const due = new Date('2026-11-26T24:00:00Z');
  it('neutral with more than half the clock left', () => {
    expect(clockBadge(due.toISOString(), created.toISOString(), new Date('2026-11-26T06:00:00Z'))).toEqual({
      tone: 'neutral',
      overdue: false,
      hours: 18,
      minutes: 0,
    });
  });
  it('amber under half the clock', () => {
    expect(
      clockBadge(due.toISOString(), created.toISOString(), new Date('2026-11-26T20:30:00Z')),
    ).toMatchObject({ tone: 'warning', overdue: false, hours: 3, minutes: 30 });
  });
  it('red once overdue, with how long overdue', () => {
    expect(
      clockBadge(due.toISOString(), created.toISOString(), new Date('2026-11-27T01:05:00Z')),
    ).toMatchObject({ tone: 'danger', overdue: true, hours: 1, minutes: 5 });
  });
});

describe('actions shown', () => {
  const item = { targetType: 'post', banWaiting: false, proposedByMe: false, decidedByMe: false };
  it('open reports: keep, remove, warn, restrict, ban for moderators; nothing for read-only staff', () => {
    expect(decisionsFor(item, cm, 'open')).toEqual(['keep', 'remove', 'warn', 'restrict', 'ban']);
    expect(decisionsFor(item, ops, 'open')).toEqual([]);
  });
  it('holds: release (keep), remove, or warn (remove + strike, SIM-B8)', () => {
    expect(decisionsFor(item, cm, 'held')).toEqual(['keep', 'remove', 'warn']);
  });
  it('a member report cannot be "removed"; a waiting ban blocks new decisions', () => {
    expect(decisionsFor({ ...item, targetType: 'member' }, cm, 'open')).not.toContain('remove');
    expect(decisionsFor({ ...item, banWaiting: true }, cm, 'open')).toEqual([]);
  });
  it('four-eyes: the proposer cannot confirm; the decider cannot decide the appeal', () => {
    expect(canConfirmBan({ ...item, banWaiting: true, proposedByMe: true }, cm)).toBe(false);
    expect(canConfirmBan({ ...item, banWaiting: true }, cm)).toBe(true);
    expect(canConfirmBan({ ...item, banWaiting: true }, ops)).toBe(false);
    expect(canDecideAppeal({ ...item, decidedByMe: true }, cm)).toBe(false);
    expect(canDecideAppeal(item, cm)).toBe(true);
  });
  it('a reviewer grants the level asked for or a lower one', () => {
    expect(grantableLevels('pakka')).toEqual(['naya', 'pakka']);
    expect(grantableLevels('master')).toEqual(['naya', 'pakka', 'bada', 'master']);
  });
});

describe('texts (en + hi)', () => {
  const c = (en as { ustaad: { console: Record<string, string> } }).ustaad.console;
  const h = (hi as { ustaad: { console: Record<string, string> } }).ustaad.console;
  it('every key has an English and a non-empty Hindi text', () => {
    expect(Object.keys(h).sort()).toEqual(Object.keys(c).sort());
    for (const [k, v] of Object.entries(h)) expect(v.trim(), k).not.toBe('');
  });
  it('codes the console shows all have a label', () => {
    const keys = [
      ...CONSOLE_SECTIONS.map((s) => `sec_${s}`),
      ...REPORT_REASONS.map((r) => `reason_${r}`),
      ...REPORT_TARGETS.map((t) => `target_${t}`),
      ...MODERATION_DECISIONS.map((d) => `act_${d}`),
      ...TAKEDOWN_BASES.map((b) => `basis_${b}`),
      ...DM_READ_REASONS.map((r) => `view_reason_${r}`),
      ...USTAAD_UNBAN_REASONS.map((r) => `unban_${r}`),
      ...USTAAD_VERIFY_REJECT_REASONS.map((r) => `reject_${r}`),
      ...['member', 'auto_word', 'auto_scam', 'auto_safety', 'legal_order', 'grievance', 'staff'].map(
        (s) => `source_${s}`,
      ),
      ...['intimate_2h', 'legal_3h', 'removal_36h', 'standard_24h', 'grievance_7d'].map((k) => `clock_${k}`),
    ];
    for (const k of keys) expect(c[k], k).toBeTruthy();
  });
  it('the admin frame ships the console namespace', () => {
    const layout = readFileSync(join(__dirname, '../src/app/[locale]/admin/layout.tsx'), 'utf8');
    expect(layout).toContain("'ustaad.console'");
  });
});
