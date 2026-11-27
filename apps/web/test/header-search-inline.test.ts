/**
 * Founder, 2026-11-27 night: under 1024 px the header shows search as an icon in the top bar; tapping it expands the
 * search field inline over the whole bar (logo and icons covered, field focused), a Close button or Escape restores
 * the bar and focus returns to the icon; suggestions drop down under the bar. No modal on phones; desktop unchanged.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (f: string) => readFileSync(join(__dirname, '..', 'src', 'components', 'site', f), 'utf8');

describe('phone search: icon in the top bar, inline field', () => {
  it('the phone trigger sits inside the top bar and the separate bar under the header is gone', () => {
    const h = src('header.tsx');
    const phone = h.indexOf('variant="phone"');
    expect(phone).toBeGreaterThan(-1);
    expect(phone).toBeLessThan(h.indexOf('</header>'));
    expect(h).not.toMatch(/px-2\.5 pt-2 tab:px-5 nav:hidden/);
  });

  it('the icon is a 48 px named button that says whether the field is open and what it controls', () => {
    const s = src('search-trigger.tsx');
    expect(s).toContain('aria-controls={isBar ? undefined : INLINE_PANEL_ID}');
    expect(s).toMatch(/aria-expanded=\{isBar \? open : phoneOpen\}/);
    expect(s).toContain('aria-label={label}');
    expect(s).toMatch(/size-12[^']*nav:hidden/);
  });

  it('opening from the phone icon renders the palette inline (no modal, no page scroll lock)', () => {
    const s = src('search-trigger.tsx');
    expect(s).toMatch(/inline=\{inline\}/);
    const p = src('header-search.tsx');
    expect(p).toContain('id={inline ? INLINE_PANEL_ID : undefined}');
    expect(p).toMatch(/if \(inline\) return undefined;\s*const previous = document\.body\.style\.overflow/);
    expect(p).toMatch(/inline\s+\?\s*'absolute inset-x-0 top-0/);
    // The field row is exactly the bar's height, so opening it shifts nothing.
    expect(p).toMatch(/inline \? 'h-14/);
  });

  it('desktop keeps the modal palette', () => {
    const p = src('header-search.tsx');
    expect(p).toContain("role: 'dialog'");
    expect(p).toContain("'aria-modal': true");
    expect(p).toContain("e.key === 'Escape'");
  });

  it('the close button is a 48 px target on phones', () => {
    expect(src('header-search.tsx')).toMatch(/inline \? 'size-12' : 'size-11'/);
  });
});
