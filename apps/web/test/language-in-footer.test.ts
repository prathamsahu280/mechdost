import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

describe('language switch lives in the footer (user 2026-11-22: "remove the hindi english toggle from the topbar … move it at the bottom near the dark mode button")', () => {
  it('the header no longer renders the language switcher', () => {
    expect(src('components/site/header.tsx')).not.toContain('<LanguageSwitcher');
  });
  it('the footer renders it next to the theme toggle', () => {
    const footer = src('components/site/footer.tsx');
    expect(footer).toMatch(
      /<LanguageSwitcher[\s\S]{0,400}<ThemeToggle|<ThemeToggle[\s\S]{0,400}<LanguageSwitcher/,
    );
  });
});

describe('the account menu also switches language (v4 header, 2026-11-23)', () => {
  it('has a language menu item that loads the other language as a full page', () => {
    const panel = src('components/auth/account-menu-panel.tsx');
    expect(panel).toContain('data-track={`language_${target}`}');
    expect(panel).toContain('window.location.assign(languageHref');
  });
});

describe('partner page passes {region} to every message that uses it (CI 2026-11-23: /hi/partners showed "undefined")', () => {
  it('points and steps get the region value', () => {
    const page = src('app/[locale]/partners/page.tsx');
    expect(page).toMatch(/t\.rich\(`\$\{kind\}Point\$\{n\}`, \{\s*region,/);
    expect(page).toContain('t(`step${n}Body`, { region })');
  });
});
