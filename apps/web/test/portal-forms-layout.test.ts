/**
 * UI state audit 2026-11-15, chunk G (batch 1c): source-level guards for the layouts and focus rings the audit found
 * broken. Rendering is covered by the audit rows named in each test; these keep the fixes from regressing.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(src, p), 'utf8');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx|ts)$/.test(p) ? [p] : [];
  });
}

describe('job photos (API-SVC-PHOTOS)', () => {
  const panel = read('components/photos/job-photos-panel.tsx');
  const at = panel.indexOf("t('remove'");
  it('the remove button sits beside its thumbnail, never absolutely positioned over it', () => {
    expect(at).toBeGreaterThan(0);
    expect(panel.slice(at, at + 400)).not.toMatch(/absolute/);
    expect(panel).not.toMatch(/-end-2 -top-2/);
  });
  it('the remove button is a 44 px target', () => {
    expect(panel.slice(at, at + 400)).toMatch(/size-11/);
  });
});

describe('focus rings (PRT-WORKSHOP-002)', () => {
  // The style constants live in portal-styles.ts since batch 0a (2026-11-16).
  const guard = read('components/portal/portal-styles.ts');
  for (const name of ['portalField', 'portalPrimary', 'portalQuiet']) {
    it(`${name} draws its own focus ring in both themes`, () => {
      const line = guard.slice(guard.indexOf(`export const ${name}`)).split(';')[0] ?? '';
      expect(line).toMatch(/focus-visible:outline-3/);
      expect(line).toMatch(/focus-visible:outline-focus/);
    });
  }
  it('no outline-none without a focus-visible replacement (except programmatic-focus containers)', () => {
    const allowed = [
      'app/[locale]/layout.tsx',
      'components/site/consent-banner.tsx',
      'components/ustaad/feed/feed-list.tsx', // tabIndex=-1 list that takes focus after "New posts" (WCAG 2.4.3)
    ];
    const offenders: string[] = [];
    for (const file of files(src)) {
      const rel = file.slice(src.length + 1).replaceAll('\\', '/');
      if (allowed.includes(rel)) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/(^|[\s"'`:])(focus:)?outline-none/.test(line) && !/focus-visible:(ring|outline)/.test(line))
            offenders.push(`${rel}:${String(i + 1)}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});

describe('demo login picker at 320 px (LOGIN-FORM)', () => {
  const login = read('components/auth/login-flow.tsx');
  const start = login.indexOf('SEEDED_ACCOUNTS.map');
  const picker = login.slice(start - 200, start + 1500);
  it('stacks one column on phones and wraps the name instead of truncating', () => {
    expect(picker).toMatch(/grid-cols-1 [^"]*sm:grid-cols-2/);
    expect(picker).not.toMatch(/truncate/);
    expect(picker).toMatch(/break-words/);
  });
  it('the button can grow with its text', () => {
    expect(picker).toMatch(/min-h-14/);
    expect(picker).toMatch(/py-2/);
  });
});

describe('workshop menu price fields (My workshop card)', () => {
  const tier1 = read('components/portal/workshop-tier1-api.tsx');
  it('the low and high fields stack on phones and sit side by side from sm', () => {
    expect(tier1).toMatch(/grid grid-cols-1 gap-3 sm:grid-cols-2/);
    expect(tier1).not.toMatch(/mt-2 grid grid-cols-2 gap-3/);
  });
});
