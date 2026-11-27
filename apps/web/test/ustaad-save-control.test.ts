import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { toggleSaved } from '../src/lib/ustaad/save-toggle';

// The shared Save control (spec 23 § 5 Saved, 2026-11-28): optimistic, rolled back on failure, one event per success.
describe('toggleSaved', () => {
  it('shows the new state at once and keeps it when the API agrees', async () => {
    const states: boolean[] = [];
    const track = vi.fn();
    const r = await toggleSaved({
      kind: 'job',
      saved: false,
      send: () => Promise.resolve({ ok: true as const, data: { saved: true } }),
      onState: (s) => states.push(s),
      track,
    });
    expect(r).toEqual({ ok: true });
    expect(states).toEqual([true]);
    expect(track).toHaveBeenCalledWith('ustaad_item_save_toggled', { kind: 'job', saved: true });
  });

  it('rolls back and returns the error code when the API refuses', async () => {
    const states: boolean[] = [];
    const track = vi.fn();
    const r = await toggleSaved({
      kind: 'lesson',
      saved: true,
      send: () => Promise.resolve({ ok: false as const, code: 'RATE_LIMITED', status: 429 }),
      onState: (s) => states.push(s),
      track,
    });
    expect(r).toEqual({ ok: false, code: 'RATE_LIMITED' });
    expect(states).toEqual([false, true]);
    expect(track).not.toHaveBeenCalled();
  });
});

describe('SaveControl component', () => {
  const src = readFileSync(
    new URL('../src/components/ustaad/saved/save-control.tsx', import.meta.url),
    'utf8',
  );
  it('announces the state with aria-pressed and a visible word, never colour alone', () => {
    expect(src).toContain('aria-pressed={saved}');
    expect(src).toMatch(/saved \? t\('saved'\) : t\('save'\)/);
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
  it('words come from the locale files (en + hi)', () => {
    for (const lang of ['en', 'hi']) {
      const json = JSON.parse(
        readFileSync(new URL(`../../../packages/shared/src/i18n/${lang}.json`, import.meta.url), 'utf8'),
      ) as { ustaad: { saveControl: Record<string, unknown> } };
      for (const k of ['save', 'saved', 'saveAria', 'savedAria', 'failed'])
        expect(json.ustaad.saveControl[k], `${lang} ${k}`).toBeTruthy();
    }
  });
});
