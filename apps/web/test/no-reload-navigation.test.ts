/**
 * "No page may feel like a reload" (user rule 2026-11-16, docs/decisions.md): moving inside the site never loads a new
 * document, and a frame shared by several routes lives in a layout so it stays mounted. Source-level guards:
 * 1. every portal with section routes has a `layout.tsx` holding the frame (guard / side bar / message bundles), and
 *    its pages render only the section content;
 * 2. no plain `<a href>` to an internal page, and no `window.location` assignment for an internal move.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcDir = resolve(__dirname, '..', 'src');
const appDir = join(srcDir, 'app', '[locale]');
const read = (p: string) => readFileSync(p, 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('portal frames live in layouts', () => {
  const portals = [
    { dir: 'admin', frame: 'AdminFrame', source: join(srcDir, 'components', 'portal', 'admin-console.tsx') },
    {
      dir: 'account',
      frame: 'AccountFrame',
      source: join(srcDir, 'components', 'account', 'account-area.tsx'),
    },
  ];

  for (const { dir, frame, source } of portals) {
    it(`${dir}: layout.tsx holds the frame and the message bundles`, () => {
      const layout = join(appDir, dir, 'layout.tsx');
      expect(existsSync(layout)).toBe(true);
      const text = read(layout);
      expect(text).toContain(`<${frame}>`);
      expect(text).toContain('ClientMessages');
      expect(text).toContain('PageIntro');
    });

    it(`${dir}: section pages render only the section, never the frame`, () => {
      const pages = walk(join(appDir, dir)).filter((f) => /[\\/]page\.tsx$/.test(f));
      expect(pages.length).toBeGreaterThanOrEqual(2);
      for (const page of pages) {
        const text = read(page);
        expect(text, relative(srcDir, page)).not.toMatch(/ClientMessages|PageIntro|PortalGuard|<Container/);
        expect(text, relative(srcDir, page)).not.toMatch(new RegExp(`<${frame}`));
      }
    });

    it(`${dir}: the frame reads the current section from the URL, not from a prop`, () => {
      const text = read(source);
      expect(text).toContain('useSelectedLayoutSegment');
    });
  }

  it('the admin and account side bars use PortalNavLink (pending cue on the clicked link)', () => {
    expect(read(join(srcDir, 'components', 'portal', 'admin-console.tsx'))).toContain('<PortalNavLink');
    expect(read(join(srcDir, 'components', 'account', 'account-area.tsx'))).toContain('<PortalNavLink');
  });
});

/**
 * Plain anchors that are fine: not an internal page (phone, mail, data, external, in-page `#hash`, helper-built
 * external links) or opened in a new tab (a document load there does not replace the page the user is on).
 */
const EXTERNAL_HREF =
  /href=(?:"(?:tel:|mailto:|https?:|#)|\{`(?:tel:|mailto:|https?:|data:|#)|\{(?:whatsappLink|directionsHref|productPhotoLoader|photoSrc)\()/;

/** Files whose plain anchor is deliberate, with the reason (anything else must be a next/link `Link`). */
const PLAIN_ANCHOR_FILES: Record<string, string> = {
  'components/auth/account-menu-panel.tsx':
    'the account menu language item: a full load on purpose, like the footer button (bugs 2026-11-13)',
  'components/site/language-switcher.tsx':
    'full load on purpose: the locale proxy sets the language cookie only on a document request (bugs 2026-11-13)',
  'components/catalogue/shop-browser.tsx': 'category chip: onClick prevents default and filters client-side',
  'components/ui/button-link.tsx': 'ExternalButtonLink: WhatsApp / phone',
  'components/portal/shop-empty.tsx': 'in-page `#id` anchor on the same screen',
  'components/portal/admin-errors-api.tsx': 'Sentry issue link (external)',
  'components/assistant/assistant-panel.tsx': 'the `external` branch of the assistant action',
};

describe('no full document load for internal moves', () => {
  const files = walk(srcDir).filter((f) => f.endsWith('.tsx'));

  it('has no plain <a> to an internal page (use next/link Link)', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(srcDir, file).split('\\').join('/');
      if (rel in PLAIN_ANCHOR_FILES) continue;
      for (const m of read(file).matchAll(/<a\b[^>]*?>/gs)) {
        const tag = m[0];
        if (EXTERNAL_HREF.test(tag) || tag.includes('target="_blank"')) continue;
        offenders.push(`${rel}: ${tag.replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the allowlisted files still contain a plain anchor (drop stale entries)', () => {
    for (const rel of Object.keys(PLAIN_ANCHOR_FILES)) {
      expect(read(join(srcDir, rel)), rel).toMatch(/<a\b/);
    }
  });

  it('assigns window.location only in the language switches (footer button, account menu item)', () => {
    const offenders: string[] = [];
    for (const file of walk(srcDir).filter((f) => /\.tsx?$/.test(f))) {
      const rel = relative(srcDir, file).split('\\').join('/');
      if (rel === 'components/site/language-switcher.tsx' || rel === 'components/auth/account-menu-panel.tsx')
        continue;
      if (/(?:window\.)?location(?:\.href)?\s*=[^=]|location\.(?:assign|replace)\(/.test(read(file)))
        offenders.push(rel);
    }
    expect(offenders).toEqual([]);
    // Walks every source file (several thousand); under a busy machine this took > 5 s (2026-11-22).
  }, 30_000);
});
