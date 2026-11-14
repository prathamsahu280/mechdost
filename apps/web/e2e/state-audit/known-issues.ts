/**
 * Bugs already reported and being fixed elsewhere (the user's four from 2026-11-14). With
 * `STATE_AUDIT_KNOWN=allow` (the per-push CI subset) matching findings are reported as annotations instead of
 * failing the test, so a known bug does not block every push while its fix is in review. The nightly and
 * overnight runs do not set it: there every finding fails its test and the checklist shows `[!]`.
 *
 * Remove an entry in the change that fixes the bug (the tests then guard the fix). Add new entries only for bugs
 * already filed in the checklist's "Found bugs" table, never to make a new finding pass.
 */
import type { AuditCase } from './cases.ts';
import type { Finding } from './geometry.ts';

export interface KnownIssue {
  bug: string;
  codes: readonly string[];
  rules: readonly string[];
  when: (c: AuditCase) => boolean;
}

export const KNOWN_ISSUES: readonly KnownIssue[] = [
  {
    bug: 'U1 compare tray of category A breaks category-B cards',
    codes: ['SHOP-CARD', 'SHOP-ACTION', 'PDP-RELATED'],
    rules: ['inside', 'overlap', 'covered', 'aligned', 'clipped'],
    when: (c) => (c.state.compare ?? 'none') !== 'none',
  },
  {
    bug: 'U2 "Start a new comparison" leaves other cards stale',
    codes: ['SHOP-ACTION'],
    rules: ['sync'],
    when: (c) => c.state.action === 'start-new' || c.state.action === 'compare-other',
  },
  {
    bug: 'U3 stepper "+" hover background covers the count',
    codes: ['STEP'],
    rules: ['covered', 'overlap'],
    when: (c) => c.state.interaction === 'hover-inc' || c.state.interaction === 'active-inc',
  },
  {
    bug: 'U4 compare columns misaligned; images too tall',
    codes: ['CMP-TABLE'],
    rules: ['aligned', 'inside', 'overlap', 'clipped'],
    when: () => true,
  },
];

export function knownIssueFor(c: AuditCase, f: Finding): KnownIssue | undefined {
  return KNOWN_ISSUES.find((k) => k.codes.includes(c.code) && k.rules.includes(f.rule) && k.when(c));
}
