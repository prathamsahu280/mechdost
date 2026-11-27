/**
 * Ustaad admin console QA fixes, 2026-11-27 night batch (docs/qa/qa-backlog-2026-11-27.md). One block per id.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { shownProblems } from '../src/lib/admin-ustaad-tables';
import { barStatus } from '../src/lib/admin-ustaad-view';
import { auditLabel, ENTITY_CODES } from '../src/lib/audit-label';
import { USTAAD_AUDIT_KINDS, ustaadAuditKind } from '../src/lib/ustaad-audit-labels';
import { leavesPage } from '../src/lib/use-leave-guard';

interface Tree {
  [k: string]: string | Tree;
}
const consoleOf = (m: unknown): Record<string, string> =>
  ((m as Tree).ustaad as Tree).console as unknown as Record<string, string>;
const src = (p: string) => readFileSync(p, 'utf8');

describe('SIM-B2 settings save bar', () => {
  it('drops "Fix the highlighted settings first." once nothing is highlighted any more', () => {
    const fix = { tone: 'error' as const, text: 'Fix', fixFirst: true };
    expect(barStatus(fix, 0)).toBeNull();
    expect(barStatus(fix, 1)).toBe(fix);
    const other: { tone: 'error'; text: string; fixFirst?: boolean } = { tone: 'error', text: 'Stale' };
    expect(barStatus(other, 0)).toBe(other);
    expect(src('src/components/portal/admin-ustaad/ustaad-settings.tsx')).toContain('barStatus(');
  });
});

describe('SIM-B14 leaving settings with unsaved edits', () => {
  const here = 'https://mechdost.com/admin/ustaad?sec=general';
  const a = (href: string, target = '') => ({ href, target, download: false });
  it('treats a side-nav link to another page as leaving', () => {
    expect(leavesPage(a('/admin'), here, false)).toBe(true);
    expect(leavesPage(a('https://mechdost.com/hi/admin/audit'), here, false)).toBe(true);
  });
  it('does not ask for the same page, a new tab, a modified click or another site', () => {
    expect(leavesPage(a('/admin/ustaad?sec=posts'), here, false)).toBe(false);
    expect(leavesPage(a('/admin', '_blank'), here, false)).toBe(false);
    expect(leavesPage(a('/admin'), here, true)).toBe(false);
    expect(leavesPage(a('https://example.com/x'), here, false)).toBe(false);
  });
  it('is wired into the Ustaad settings screen with words in en and hi', () => {
    expect(src('src/components/portal/admin-ustaad/ustaad-settings.tsx')).toContain('useLeaveGuard(');
    for (const m of [en, hi])
      expect((((m as unknown as Tree).ustaad as Tree).admin as Tree).leave_unsaved).toBeTruthy();
  });
});

describe('SIM-B7 / SIM-B3 Ustaad table forms', () => {
  const problems = { titleEn: { kind: 'type' as const }, link: { kind: 'type' as const } };
  it('shows no field error before the person typed in it or pressed Save (SIM-B7)', () => {
    expect(shownProblems(problems, new Set(), false)).toEqual({});
    expect(shownProblems(problems, new Set(['link']), false)).toEqual({ link: { kind: 'type' } });
    expect(shownProblems(problems, new Set(), true)).toEqual(problems);
  });

  it('puts a refused save next to the Save button and moves focus there (SIM-B3)', () => {
    const s = src('src/components/portal/admin-ustaad/ustaad-tables.tsx');
    expect(s).toContain('shownProblems(');
    expect(s).toMatch(/id=\{`\$\{baseId\}-form-error`\}/);
    expect(s).toContain('setPendingFocus(`${baseId}-form-error`)');
  });
});

describe('SIM-B6 / SIM-B15 Ustaad audit words', () => {
  it('names a verification approval and other moderation actions', () => {
    expect(ustaadAuditKind('ustaad.verification.approved')).toBe('verification_approved');
    expect(ustaadAuditKind('ustaad.verification.rejected')).toBe('verification_rejected');
    expect(ustaadAuditKind('ustaad.appeal_upheld')).toBe('appeal_upheld');
    expect(ustaadAuditKind('ustaad.level_rule.updated')).toBe('level_rule_changed');
    expect(ustaadAuditKind('ustaad.ban')).toBe('ban');
    expect(ustaadAuditKind('ustaad.something_new')).toBe('other');
  });

  it('has en and hi words for every kind', () => {
    for (const m of [en, hi]) {
      const c = consoleOf(m);
      for (const k of USTAAD_AUDIT_KINDS) expect(c[`audit_${k}`], `audit_${k}`).toBeTruthy();
    }
  });

  it('Admin → Audit log words Ustaad rows and can filter Ustaad entities (SIM-B15)', () => {
    expect(src('src/components/portal/admin-audit-api.tsx')).toContain('isUstaadAction(');
    for (const e of ['ustaad_post', 'ustaad_member', 'ustaad_verification', 'ustaad_report'])
      expect(ENTITY_CODES).toContain(e);
    const dict = (m: unknown) => {
      const w = ((m as Tree).adminPeople as Tree).auditWord as unknown as Record<string, string>;
      return { word: (k: string) => w[k] ?? null, action: () => null };
    };
    for (const m of [en, hi]) expect(auditLabel('ustaad_post', dict(m)).known).toBe(true);
  });

  it('My actions uses the shared words', () => {
    expect(src('src/components/portal/admin-ustaad/console-records.tsx')).toContain('ustaadAuditKind(');
  });
});
