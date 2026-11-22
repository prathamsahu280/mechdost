/**
 * JS budget (spec 16, incident 2026-11-22: after the audience pages /shop measured 180.8 and /cart 180.7 KB gz).
 * Two wins keep real headroom: the locale files are precompiled at build time (the ICU parser stays out of every
 * client bundle), and the Hindi product text of the demo search is a chunk of its own.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import notifyEn from '../../../packages/shared/src/notify-templates/en.json';
import notifyHi from '../../../packages/shared/src/notify-templates/hi.json';
import { builtInPolicy } from '../src/lib/policy-view';

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

/** Every string in a messages tree with its dotted path. */
function strings(tree: unknown, path = ''): [string, string][] {
  if (typeof tree === 'string') return [[path, tree]];
  if (typeof tree !== 'object' || tree === null) return [];
  return Object.entries(tree).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k));
}

describe('locale files are precompiled at build time', () => {
  it('the plugin is configured to precompile the shared locale files', () => {
    const config = src('next.config.ts');
    expect(config).toMatch(/precompile: true/);
    expect(config).toMatch(/packages\/shared\/src\/i18n/);
  });

  it('the WhatsApp texts ({{n}} is Meta syntax, not ICU) live outside the precompiled folder', () => {
    expect(Object.keys(en)).not.toContain('notifyTemplates');
    expect(Object.keys(hi)).not.toContain('notifyTemplates');
    expect(JSON.stringify(notifyEn)).toContain('{{1}}');
    expect(Object.keys(notifyHi)).toEqual(Object.keys(notifyEn));
  });

  it('no locale message uses the Meta {{n}} syntax (the precompiler rejects it)', () => {
    for (const [path, text] of [...strings(en), ...strings(hi)]) {
      expect(text, path).not.toMatch(/\{\{\d+\}\}/);
    }
  });

  it('code that reads message text directly does not depend on the raw ICU string', () => {
    // `t.raw()` returns the compiled message; the demo labour promise fills the placeholder through `t(key, values)`.
    expect(src('src/components/site/labour-promise.tsx')).not.toMatch(/\.raw\(/);
    // The root error copy is embedded as plain JSON for the error boundary.
    for (const messages of [en, hi]) {
      for (const [path, text] of strings(messages.errorPage)) expect(text, path).not.toMatch(/[{}']/);
    }
  });

  it('the policy editor reads built-in text from compiled messages too', () => {
    const compiled = {
      policies: {
        privacy: {
          title: 'Privacy',
          lead: 'Lead',
          whoTitle: 'Who',
          whoBody: ['Run by ', ['company'], ', ', ['address'], '. Claims within ', ['days'], ' days.'],
        },
      },
    };
    const doc = builtInPolicy(compiled, 'policy.privacy', '2026-11-22');
    expect(doc?.sections[0]?.body).toBe('Run by {company}, {address}. Claims within 7 days.');
  });
});

describe('the demo shop search keeps the Hindi text out of the first load', () => {
  it('the catalogue and its search text import only the type of the Hindi overlay', () => {
    expect(src('src/demo/i18n/product-search.ts')).not.toMatch(/import \{[^}]*PRODUCT_HI/);
    expect(src('src/demo/catalogue.ts')).not.toMatch(/import \{[^}]*PRODUCT_HI/);
    expect(src('src/demo/catalogue.ts')).toMatch(/import type \{ ProductHi \}/);
  });

  it('the shop island fetches the overlay with import() and passes it to the search', () => {
    const browser = src('src/components/catalogue/shop-browser.tsx');
    expect(browser).toMatch(/import\('@\/demo\/i18n\/hi-products'\)/);
    // Type-only imports are erased; a value import would put the Hindi text back in the first load.
    expect(browser).not.toMatch(/^import (?!type ).*hi-products/m);
    expect(browser).toMatch(/hi: hiText/);
  });
});

describe('precompiled messages: a literal {token} shown to the admin is passed explicitly (CI 2026-11-22)', () => {
  // With precompiled messages a missing argument renders "undefined"; /hi/admin/content showed
  // "ब्रांड के नाम के लिए undefined लिखें" until the token was passed as a value.
  it('the trust line labels pass {brand}', () => {
    for (const f of ['components/portal/admin-site.tsx', 'components/portal/admin-site-api.tsx']) {
      const src = readFileSync(join(__dirname, '..', 'src', f), 'utf8');
      expect(src, f).toMatch(
        /tt\(`lineLabel_\$\{trustPlacementOf\(key\) \?\? 'product'\}`, \{ brand: '\{brand\}' \}\)/,
      );
    }
  });
});
