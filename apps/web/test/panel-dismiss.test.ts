/**
 * "Opened panel cannot be closed" (user 2026-11-16: the review form opened by "Write a review" had no Cancel).
 * Contract (src/lib/panel-dismiss.ts): the opener carries `data-disclosure-trigger="<key>"`, the panel a visible
 * Cancel button carrying `data-panel-cancel="<key>"`; `PanelDismiss` maps Escape to that button and returns focus
 * to the opener. This file tests the lookup logic, the review forms, and a source guard over every component.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import {
  TRIGGER_ATTR,
  findPanelCancel,
  isDismissKey,
  triggerSelector,
  type PanelDocument,
  type PanelNode,
} from '../src/lib/panel-dismiss';

const srcDir = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(srcDir, p), 'utf8');

/** Tiny DOM stand-in: nodes with attributes, children and a parent; selector support for the two forms used. */
class Fake implements PanelNode {
  parentElement: Fake | null = null;
  children: Fake[] = [];
  constructor(
    private attrs: Record<string, string> = {},
    kids: Fake[] = [],
  ) {
    for (const k of kids) {
      k.parentElement = this;
      this.children.push(k);
    }
  }
  getAttribute(name: string) {
    return this.attrs[name] ?? null;
  }
  matches(selector: string): boolean {
    if ('disabled' in this.attrs) return false;
    const m = /^\[([a-z-]+)(?:="([^"]*)")?\]:not\(\[disabled\]\)$/.exec(selector);
    if (!m) return false;
    const v = this.attrs[m[1] ?? ''];
    return v !== undefined && (m[2] === undefined || m[2] === v);
  }
  all(): Fake[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
  querySelector(selector: string) {
    return this.all().find((n) => n.matches(selector)) ?? null;
  }
  querySelectorAll(selector: string) {
    return this.all().filter((n) => n.matches(selector));
  }
}

describe('findPanelCancel', () => {
  it('finds the Cancel button of the panel that holds focus, not another open panel', () => {
    const cancelA = new Fake({ 'data-panel-cancel': 'a' });
    const fieldA = new Fake();
    const cancelB = new Fake({ 'data-panel-cancel': 'b' });
    const fieldB = new Fake();
    const root = new Fake({}, [new Fake({}, [fieldA, cancelA]), new Fake({}, [fieldB, cancelB])]);
    expect(findPanelCancel(fieldA, root as PanelDocument)).toBe(cancelA);
    expect(findPanelCancel(fieldB, root as PanelDocument)).toBe(cancelB);
  });

  it('uses data-panel-for when the Cancel button is outside the panel (a toggle)', () => {
    const toggle = new Fake({ 'data-panel-cancel': 'row1' });
    const field = new Fake();
    const panel = new Fake({ 'data-panel-for': 'row1' }, [field]);
    const root = new Fake({}, [toggle, panel]);
    expect(findPanelCancel(field, root as PanelDocument)).toBe(toggle);
  });

  it('with focus on the page body (the opener unmounted), closes the most recently opened panel', () => {
    const one = new Fake({ 'data-panel-cancel': 'a' });
    expect(findPanelCancel(null, new Fake({}, [one]) as PanelDocument)).toBe(one);
    const a = new Fake({ 'data-panel-cancel': 'a' });
    const b = new Fake({ 'data-panel-cancel': 'b' });
    const two = new Fake({}, [a, b]);
    expect(findPanelCancel(null, two as PanelDocument, 'a')).toBe(a);
    expect(findPanelCancel(null, two as PanelDocument, 'gone')).toBe(b);
    expect(findPanelCancel(null, two as PanelDocument)).toBe(b);
  });

  it('with focus on an opener whose container holds several panels, prefers the one just opened', () => {
    const a = new Fake({ 'data-panel-cancel': 'a' });
    const b = new Fake({ 'data-panel-cancel': 'b' });
    const opener = new Fake({ 'data-disclosure-trigger': 'b' });
    const root = new Fake({}, [new Fake({}, [opener, a, b])]);
    expect(findPanelCancel(opener, root as PanelDocument, 'b')).toBe(b);
    expect(findPanelCancel(opener, root as PanelDocument)).toBe(a);
  });

  it('ignores a disabled Cancel button (a sending form) and a page with no panel', () => {
    const root = new Fake({}, [new Fake({ 'data-panel-cancel': 'a', disabled: '' })]);
    expect(findPanelCancel(null, root as PanelDocument)).toBeNull();
  });
});

describe('isDismissKey / triggerSelector', () => {
  const base = { key: 'Escape', defaultPrevented: false };
  it('accepts a plain Escape only', () => {
    expect(isDismissKey(base)).toBe(true);
    expect(isDismissKey({ ...base, key: 'Enter' })).toBe(false);
    expect(isDismissKey({ ...base, defaultPrevented: true })).toBe(false);
    expect(isDismissKey({ ...base, isComposing: true })).toBe(false);
    expect(isDismissKey({ ...base, ctrlKey: true })).toBe(false);
  });
  it('escapes the key in the trigger selector', () => {
    expect(triggerSelector('review-order-a"b')).toBe('[data-disclosure-trigger="review-order-a\\"b"]');
  });
});

describe('the review forms', () => {
  for (const file of ['components/reviews/local-reviews.tsx', 'components/reviews/write-review-api.tsx']) {
    const s = read(file);
    it(`${file}: Cancel button next to Submit, 44 px, tracked, wired to the opener`, () => {
      expect(s).toMatch(/data-panel-cancel=/);
      expect(s).toMatch(/data-disclosure-trigger=/);
      expect(s).toMatch(/data-track=\{?[`'"]review_cancel_/);
      expect(s).toMatch(/t\('cancel'\)/);
      const cancel = s.slice(s.indexOf('data-panel-cancel='));
      expect(cancel.slice(0, 400)).toContain('min-h-11');
    });
  }
  it('has Cancel text in both locales', () => {
    expect(en.reviews.cancel).toBeTruthy();
    expect(hi.reviews.cancel).toBeTruthy();
    expect(hi.reviews.cancel).not.toBe(en.reviews.cancel);
  });
  it('the layout mounts PanelDismiss once', () => {
    expect(read('app/[locale]/layout.tsx')).toMatch(/<PanelDismiss\s*\/>/);
  });
  it('loads the dismiss logic only on the first opener click or Escape (JS budget, 2026-11-16)', () => {
    // Mounted on every page: a static import put ~0.6 KB gz in every first load (/shop 180.2, /cart 180.0 > 180).
    const mount = read('components/site/panel-dismiss.tsx');
    // Type-only imports are erased; a value import would put the module back in the first load.
    expect(mount).not.toMatch(/^import (?!type )[^;]*from '@\/lib\/panel-dismiss/m);
    expect(mount).toMatch(/import\('@\/lib\/panel-dismiss-runtime'\)/);
    const runtime = read('lib/panel-dismiss-runtime.ts');
    expect(runtime).toMatch(/export function installPanelDismiss/);
    // The mount repeats the trigger attribute as a literal; it must match the contract.
    expect(mount).toContain(`const TRIGGER = '${TRIGGER_ATTR}';`);
  });
});

/**
 * Source guard (the repo has no DOM test env): any client component that opens something in place with a state
 * setter (`setOpen(true)`, `setEditing(x)`, `setAdding(true)`, `setForm({...})`, `setCancelling(true)`) must render
 * a Cancel control marked `data-panel-cancel` and mark its opener `data-disclosure-trigger`, unless it is on the
 * list below with the reason it is already closeable (a dialog primitive, or a toggle that is its own close).
 */
const EXEMPT: Record<string, string> = {
  'components/site/consent-banner.tsx': 'banner with own Escape handler and a dismiss button',
  'components/site/search-trigger.tsx':
    'header search palette: modal dialog with a close button, Escape, a tap on the dimmed page and focus return (header-search.tsx)',
  'components/notices/bell-controller.tsx': 'menu with own Escape handler, outside-click and focus return',
  'components/assistant/assistant-launcher.tsx': 'chat dialog with its own close button and Escape handler',
  'components/partners/partner-status.tsx':
    'status-lookup wizard (form, code, result): a visible restart button per step',
  'components/ustaad/feed/post-menu.tsx':
    'steps inside a native modal <dialog> sheet (Escape, the close button and a tap outside close it; Cancel on confirms)',
  'components/ustaad/feed/comments-sheet.tsx':
    'setMode switches the comment input (text / voice / photo) inside the sheet; nothing opens in place',
  'components/portal/shop-csv-api.tsx':
    'file-check steps: "Choose another file" resets; the file field is always visible',
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const OPENER =
  /\bset(Open|Editing|Adding|Cancelling|Creating|OpenId|OpenCode|NoReason|Form|Declining|Pausing|Removing|Rejecting|Choosing|Mode|Panel|Step)\(\s*(true|'(?!idle|none|card)[a-z_]+'|\{\s*(kind|coupon|pincode|lift|revoke)|[a-z]+\.(id|slug|code|photoId|userId)|EMPTY|\w+\s*\?)/;

describe('every component that opens a panel in place can close it', () => {
  const files = walk(join(srcDir, 'components'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => ({ rel: relative(srcDir, f).split('\\').join('/'), text: readFileSync(f, 'utf8') }))
    .filter((f) => OPENER.test(f.text));

  it('finds the components (guards against the pattern rotting)', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const { rel, text } of files) {
    if (EXEMPT[rel]) continue;
    it(`${rel} has a data-panel-cancel control and a marked opener`, () => {
      expect(text, 'missing data-panel-cancel').toMatch(/data-panel-cancel/);
      expect(text, 'missing data-disclosure-trigger').toMatch(/data-disclosure-trigger/);
    });
  }
});
