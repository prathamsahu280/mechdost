/**
 * "Where you're signed in" (spec 01 § Devices, 2026-11-28): last-active wording buckets, the card's guards (lazy,
 * real mode only, no raw strings, attribution, no events carrying places) and the best-effort sign-out helper.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { activeAgo, istDate } from '../src/lib/device-time';

const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
const NOW = Date.parse('2026-11-28T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('activeAgo', () => {
  it('buckets by age', () => {
    expect(activeAgo(ago(0), NOW)).toEqual({ kind: 'now' });
    expect(activeAgo(ago(4 * 60_000), NOW)).toEqual({ kind: 'now' });
    expect(activeAgo(ago(10 * 60_000), NOW)).toEqual({ kind: 'minutes', n: 10 });
    expect(activeAgo(ago(3 * 3600_000), NOW)).toEqual({ kind: 'hours', n: 3 });
    expect(activeAgo(ago(2 * 86_400_000), NOW)).toEqual({ kind: 'days', n: 2 });
    expect(activeAgo(ago(45 * 86_400_000), NOW)).toEqual({ kind: 'date' });
  });
  it('a time in the future or unreadable counts as now', () => {
    expect(activeAgo(new Date(NOW + 5000).toISOString(), NOW)).toEqual({ kind: 'now' });
    expect(activeAgo('nonsense', NOW)).toEqual({ kind: 'now' });
  });
  it('formats the date in IST', () => {
    expect(istDate('2026-11-28T20:00:00Z', 'en')).toMatch(/29/); // 01:30 IST next day
  });
});

describe('DevicesCard source guards', () => {
  const card = src('components/account/devices-card.tsx');
  it('is mounted lazily after the Security card', () => {
    const sections = src('components/account/account-api-sections.tsx');
    expect(sections).toMatch(/lazy\(\(\) => import\('\.\/devices-card'\)/);
    expect(sections.indexOf('<SecurityCard')).toBeLessThan(sections.indexOf('<DevicesCard'));
  });
  it('shows only in real sign-in mode and keeps a polite status region', () => {
    expect(card).toContain("AUTH_MODE !== 'firebase'");
    expect(card).toContain('role="status"');
    expect(card).toContain('aria-live="polite"');
  });
  it('credits DB-IP and offers no button on this device', () => {
    expect(card).toContain('https://db-ip.com');
    expect(card).toContain('d.current ? null');
  });
  it('links to ids that exist in the Security card (its heading and the Sign out of all devices section)', () => {
    const security = src('components/account/security-card.tsx');
    expect(security).toContain('id="security-title"');
    expect(security).toContain('id="security-signout-all-title"');
    expect(card).toContain('href="#security-signout-all-title"');
    expect(card).toContain('href="#security-title"');
  });
  it('after a row disappears focus moves to the card heading (not lost), and anchored headings keep scroll margin', () => {
    expect(card).toContain('tabIndex={-1}');
    expect((card.match(/titleRef\.current\?\.focus\(\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
    const security = src('components/account/security-card.tsx');
    expect(security).toMatch(/id="security-title" className="scroll-mt-24/);
    expect(security).toMatch(/id="security-signout-all-title"\s+className="scroll-mt-24/);
  });
  it('decorative icons are hidden from assistive tech', () => {
    expect(card).toContain('<Icon aria-hidden="true"');
  });
  it('tracks only counts and enum codes (no place, no user agent)', () => {
    const tracks = card.match(/track\('account_[a-z_]+', \{[^}]*\}\)/g) ?? [];
    expect(tracks.length).toBe(3);
    for (const t of tracks) expect(t).not.toMatch(/place|city|region|userAgent/i);
  });
});

describe('endCurrentDevice', () => {
  it('is fire and forget: never throws, does nothing without a token', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://api.test');
    vi.resetModules();
    const calls: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(url);
      return Promise.reject(new Error('offline'));
    });
    const { endCurrentDevice } = await import('../src/lib/auth/end-current-device');
    expect(() => {
      endCurrentDevice(null);
    }).not.toThrow();
    expect(calls).toEqual([]);
    expect(() => {
      endCurrentDevice('token-token-token-token-token');
    }).not.toThrow();
    expect(calls).toEqual(['http://api.test/v1/me/devices/current/sign-out']);
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
});
