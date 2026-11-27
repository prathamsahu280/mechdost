/**
 * Ustaad QA audit § 3 row 11 (founder approved 2026-11-27 night): members never saw a link to the community rules.
 * A small "Read the network rules" link (≥ 24 px target, WCAG 2.5.8) goes to /policies/community-rules from Home,
 * Jobs, Me, both report forms, the post composer and the held-post note.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';

const src = (f: string) => readFileSync(join(__dirname, '..', 'src', f), 'utf8');

describe('community rules link', () => {
  it('has its words in English and Hindi', () => {
    expect(en.ustaad.shell.rulesLink).toBe('Read the network rules');
    expect(hi.ustaad.shell.rulesLink).toBe('नेटवर्क के नियम पढ़ें');
  });

  it('links to the community rules with a 24 px target and a click event', () => {
    const c = src('components/ustaad/rules-link.tsx');
    expect(c).toContain("localePath('/policies/community-rules', locale)");
    expect(c).toMatch(/min-h-6/);
    expect(c).toContain('data-track={`ustaad_rules_link_${place}`}');
    expect(c).toContain("useTranslations('ustaad.shell')");
  });

  it.each([
    ['Home', 'app/[locale]/ustaad/page.tsx'],
    ['Jobs', 'components/ustaad/jobs/jobs-view.tsx'],
    ['Me', 'app/[locale]/ustaad/me/page.tsx'],
    ['post report sheet', 'components/ustaad/feed/post-menu.tsx'],
    ['message report dialog', 'components/ustaad/messages/report-dialog.tsx'],
    ['composer', 'components/ustaad/feed/composer.tsx'],
    ['held-post note', 'components/ustaad/feed/post-card.tsx'],
  ])('%s shows the link', (_, f) => {
    expect(src(f)).toMatch(/<RulesLink place="[a-z_]+"/);
  });
});
