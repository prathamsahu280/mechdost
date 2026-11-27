/**
 * The v4 site chrome (user-approved 2026-11-23, `docs/design-system.md` "Site chrome"): floating glass header, account
 * menu, search palette, v4 footer and the floating dock. Source guards for what must never regress: no emoji in the
 * chrome, Sign out inside the account menu, panels that load lazily, no icon library in the first-load client islands,
 * accessible names and keyboard behaviour of the menu, and English/Hindi parity of the new strings.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
/** Source without comments, so a typographic arrow in a code comment is not mistaken for an emoji. */
const code = (p: string) =>
  src(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const CHROME_FILES = [
  'components/site/header.tsx',
  'components/site/footer.tsx',
  'components/site/nav-links.tsx',
  'components/site/nav-icons.tsx',
  'components/site/mobile-tab-bar.tsx',
  'components/site/theme-toggle.tsx',
  'components/site/language-switcher.tsx',
  'components/site/search-trigger.tsx',
  'components/site/header-search.tsx',
  'components/auth/account-menu.tsx',
  'components/auth/account-menu-panel.tsx',
  'components/commerce/cart-pill.tsx',
  'components/notices/bell.tsx',
  'components/notices/bell-controller.tsx',
  'components/notices/notice-item.tsx',
];

describe('no emoji in the header, footer, tab dock or their menus', () => {
  it.each(CHROME_FILES)('%s has no emoji and does not import the emoji table', (file) => {
    const text = code(file);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(text).not.toMatch(/lib\/emoji/);
  });
  it('the emoji table no longer carries navigation or chrome emoji', () => {
    const table = src('lib/emoji.ts');
    expect(table).not.toMatch(/NAV_EMOJI|signOut|bell:|language:/);
  });
});

describe('the account menu', () => {
  const menu = src('components/auth/account-menu.tsx');
  const panel = src('components/auth/account-menu-panel.tsx');

  it('contains Sign out, profile, orders, vehicles, saved items, dark mode and language', () => {
    for (const k of [
      'copy.signOut',
      'copy.profile',
      'copy.orders',
      'copy.vehicles',
      'copy.saved',
      'copy.dark',
    ])
      expect(panel).toContain(k);
    expect(panel).toContain('copy.language');
    expect(panel).toContain('copy.portal'); // portal roles keep their portal link
  });

  it('follows the WAI-ARIA menu button pattern', () => {
    expect(menu).toContain('aria-haspopup="menu"');
    expect(menu).toContain('aria-expanded={open}');
    expect(panel).toContain('role="menu"');
    expect(panel).toContain('role="menuitemcheckbox"');
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape', 'Tab'])
      expect(panel).toContain(`'${key}'`);
    // Outside click closes it; Escape gives focus back to the avatar.
    expect(panel).toContain("addEventListener('pointerdown'");
    expect(panel).toContain('onClose(true)');
  });

  it('is a lazy chunk: the avatar button loads it with import(), never statically', () => {
    expect(menu).toMatch(/import\('\.\/account-menu-panel'\)/);
    expect(menu).not.toMatch(/from '\.\/account-menu-panel'/);
  });

  it('the dark-mode row and the language row share the footer behaviour (theme storage, full page load)', () => {
    expect(panel).toContain("from '@/lib/theme-client'");
    expect(panel).toContain('window.location.assign(languageHref');
  });
});

describe('panels load lazily and stay out of the first load', () => {
  it('the search pill loads the palette with import() only', () => {
    const trigger = src('components/site/search-trigger.tsx');
    expect(trigger).toMatch(/import\('\.\/header-search'\)/);
    expect(trigger).not.toMatch(/from '\.\/header-search'/);
  });

  it('the palette is a labelled modal dialog (desktop) with a combobox and closes with Escape', () => {
    // Phones open it inline over the top bar instead (founder 2026-11-27 night; test/header-search-inline.test.ts).
    const palette = src('components/site/header-search.tsx');
    expect(palette).toContain("role: 'dialog'");
    expect(palette).toContain("'aria-modal': true");
    expect(palette).toContain('role="combobox"');
    expect(palette).toContain("e.key === 'Escape'");
    expect(palette).toContain('createPortal');
  });

  it('the palette reaches the suggestion code only through the shared lazy paths', () => {
    const palette = src('components/site/header-search.tsx');
    expect(palette).toMatch(/import\('@\/demo\/smart-search'\)/);
    expect(palette).toContain("from '@/lib/catalogue-public-api'");
  });

  it('the bell panel is still its own chunk', () => {
    expect(src('components/notices/bell.tsx')).toMatch(/import\('\.\/bell-controller'\)/);
  });

  it('first-load client islands import no icon library (the server renders the icons and passes them in)', () => {
    for (const f of [
      'components/site/nav-links.tsx',
      'components/site/mobile-tab-bar.tsx',
      'components/site/search-trigger.tsx',
      'components/site/theme-toggle.tsx',
      'components/site/language-switcher.tsx',
      'components/auth/account-menu.tsx',
      'components/commerce/cart-pill.tsx',
      'components/notices/bell.tsx',
    ])
      expect(src(f), f).not.toMatch(/from 'lucide-react'/);
  });
});

describe('header, nav and dock structure', () => {
  const header = src('components/site/header.tsx');
  const nav = src('components/site/nav-links.tsx');
  const dock = src('components/site/mobile-tab-bar.tsx');

  it('has no separate theme toggle or sign-out button in the header', () => {
    expect(header).not.toContain('ThemeToggle');
    expect(header).not.toContain('LanguageSwitcher');
    expect(header).not.toContain('header_sign_out');
  });

  it('keeps the sticky header landmark the UI state audit targets, with a fixed outer height', () => {
    expect(header).toMatch(/<header className="sticky top-0 z-30 h-\[66px\][^"]*nav:h-\[78px\]/);
  });

  it('marks the current page (aria-current, the white chip with the tread) in the nav and the dock', () => {
    expect(nav).toContain("aria-current={active ? 'page' : undefined}");
    expect(nav).toContain('nav-chip-active');
    expect(dock).toContain("aria-current={active ? 'page' : undefined}");
    expect(dock).toContain('bg-accent-soft');
  });

  it('the dock floats above the safe area and keeps 48 px+ targets', () => {
    expect(dock).toContain('bottom-[calc(12px+env(safe-area-inset-bottom))]');
    expect(dock).toContain('min-h-[52px]');
    expect(dock).toContain('nav:hidden');
  });

  it('the bar shrinks on scroll with CSS only, and not under reduced motion', () => {
    const css = src('app/[locale]/globals.css');
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.header-bar\s*\{[^}]*animation-timeline: scroll\(root block\)/,
    );
    expect(css).toContain('@keyframes header-shrink');
    expect(css).toContain('.nav-chip-active::after');
  });

  it('every primary control carries an analytics click id (spec 12)', () => {
    const all = [
      header,
      nav,
      dock,
      src('components/site/search-trigger.tsx'),
      src('components/auth/account-menu.tsx'),
    ].join('\n');
    for (const id of [
      'brand_home',
      'header_search',
      'header_search_phone',
      'header_account',
      'header_sign_in',
    ])
      expect(all, id).toContain(id);
    const panel = src('components/auth/account-menu-panel.tsx');
    for (const id of [
      'menu_profile',
      'menu_orders',
      'menu_vehicles',
      'menu_saved',
      'menu_portal',
      'menu_dark_mode',
      'header_sign_out',
    ])
      expect(panel, id).toContain(id);
  });
});

describe('footer', () => {
  const footer = src('components/site/footer.tsx');
  it('keeps every column, the help card, legal row, policies and the dark-mode and language buttons', () => {
    for (const k of [
      "id: 'shop'",
      "id: 'care'",
      "id: 'account'",
      "id: 'business'",
      'footer-col-partners',
      'footer_whatsapp',
      'footer_call',
      '<CompanyLegal',
      '<CompanyCopyright',
      '<ConsentChoicesButton',
      'POLICY_LINKS.map',
      '<LanguageSwitcher',
      '<ThemeToggle',
    ])
      expect(footer, k).toContain(k);
  });
});

describe('new strings exist in English and Hindi with the same placeholders', () => {
  const holes = (s: string) => [...s.matchAll(/\{(\w+)(?=[,}])/g)].map((m) => m[1]).sort();
  it('the chrome namespace', () => {
    const a = en.chrome as Record<string, string>;
    const b = hi.chrome as Record<string, string>;
    expect(Object.keys(b)).toEqual(Object.keys(a));
    for (const k of Object.keys(a)) {
      expect(b[k], k).toBeTruthy();
      expect(holes(b[k] ?? ''), k).toEqual(holes(a[k] ?? ''));
    }
  });
  it('the menu language label', () => {
    expect(en.language.switch).toBeTruthy();
    expect(hi.language.switch).toBeTruthy();
  });
  it('every placeholder is given a value where the message is used', () => {
    const header = src('components/site/header.tsx');
    expect(header).toContain("c('searchCount', { count: '{count}' })");
    expect(header).toContain("c('searchSeeAll', { query: '{query}' })");
  });
});

describe('chrome v4 CI regressions (2026-11-23)', () => {
  it('the phone search icon has no visible text, so the label names it (was: bar named by its text)', () => {
    const s = src('components/site/search-trigger.tsx');
    expect(s).toContain('aria-label={label}');
    expect(s).toContain('{isBar ? <span className="sr-only min-[1440px]:not-sr-only">{text}</span> : null}');
  });
  it('footer links are at least 24px wide (short Hindi words like कार्ट)', () => {
    expect(src('components/site/footer.tsx')).toMatch(/inline-flex min-h-10 min-w-6 /);
  });
});
