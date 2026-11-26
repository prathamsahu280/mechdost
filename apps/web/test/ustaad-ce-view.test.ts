import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { createWatchMeter } from '../src/lib/ustaad/learn-meter';
import {
  accuracyBand,
  gpsIsWeak,
  distanceM,
  nudge,
  pinSource,
  payRangeText,
  rupeesToPaise,
  zoneShade,
  zoneText,
  projectZones,
} from '../src/lib/ustaad/local-view';
import { parseQuestionFilter, questionChip } from '../src/lib/ustaad/qa-view';

describe('Learn watch meter (heartbeat every 15 s, spec 23 § 21b)', () => {
  it('counts only time while playing and hands out whole seconds', () => {
    const m = createWatchMeter();
    m.play(0);
    expect(m.take(15_400)).toBe(15);
    m.pause(20_000);
    expect(m.take(60_000)).toBe(5); // 15.4 → 20 s while playing (0.4 carried)
  });
  it('returns null below one second and never more than 300', () => {
    const m = createWatchMeter();
    m.play(0);
    expect(m.take(500)).toBeNull();
    expect(m.take(1_000_000)).toBe(300);
  });
  it('a seek does not count as watching', () => {
    const m = createWatchMeter();
    expect(m.take(10_000)).toBeNull();
  });
});

describe('Q&A view helpers', () => {
  it('unknown filters fall back to All', () => {
    expect(parseQuestionFilter('mine')).toBe('mine');
    expect(parseQuestionFilter('drop table')).toBe('all');
    expect(parseQuestionFilter(undefined)).toBe('all');
  });
  it('the chip says Solved, New (no answer) or the answer count', () => {
    expect(questionChip({ status: 'solved', answers: 3 })).toEqual({ key: 'solved' });
    expect(questionChip({ status: 'open', answers: 0 })).toEqual({ key: 'new' });
    expect(questionChip({ status: 'answered', answers: 2 })).toEqual({ key: 'answers', n: 2 });
  });
});

describe('Pin my garage', () => {
  it('GPS worse than the setting is weak (landmark path)', () => {
    expect(gpsIsWeak(40, 100)).toBe(false);
    expect(gpsIsWeak(140, 100)).toBe(true);
  });
  it('accuracy bands for analytics never carry the number', () => {
    expect(accuracyBand(12)).toBe('lt20');
    expect(accuracyBand(20)).toBe('20to50');
    expect(accuracyBand(99)).toBe('50to100');
    expect(accuracyBand(101)).toBe('gt100');
  });
  it('nudge moves the pin about 10 m per press', () => {
    const p = { lat: 21.25, lng: 81.63 };
    const up = nudge(p, 'up');
    expect(up.lng).toBe(p.lng);
    expect((up.lat - p.lat) * 111_320).toBeCloseTo(10, 0);
    const right = nudge(p, 'right');
    expect(right.lat).toBe(p.lat);
    expect(right.lng).toBeGreaterThan(p.lng);
  });
});

describe('pin source: GPS while the pin stays inside the fix', () => {
  const fix = { lat: 21.25, lng: 81.63, accuracyM: 25 };
  it('distance is in metres', () => {
    expect(distanceM({ lat: 21.25, lng: 81.63 }, { lat: 21.2509, lng: 81.63 })).toBeCloseTo(100, -1);
  });
  it('a small nudge keeps the GPS reading; a move past the circle is placed by hand', () => {
    expect(pinSource(fix, nudge(fix, 'up'), 100)).toBe('gps');
    expect(pinSource(fix, { lat: 21.2509, lng: 81.63 }, 100)).toBe('manual');
  });
  it('no fix, or a weak fix, is always by hand', () => {
    expect(pinSource(null, fix, 100)).toBe('manual');
    expect(pinSource({ ...fix, accuracyM: 140 }, fix, 100)).toBe('manual');
  });
});

describe('Area map shows only what the server banded', () => {
  it('text follows the band kind; nothing is summed or derived', () => {
    expect(zoneText({ kind: 'few' })).toEqual({ key: 'few' });
    expect(zoneText({ kind: 'band', value: 5 })).toEqual({ key: 'band', n: 5 });
    expect(zoneText({ kind: 'exact', value: 25 })).toEqual({ key: 'exact', n: 25 });
  });
  it('shade grows with the band', () => {
    expect(zoneShade({ kind: 'few' })).toBe(0);
    expect(zoneShade({ kind: 'band', value: 5 })).toBe(1);
    expect(zoneShade({ kind: 'exact', value: 25 })).toBe(2);
    expect(zoneShade({ kind: 'exact', value: 60 })).toBe(3);
  });
  it('projects zone centres into the drawing box (north up)', () => {
    const pts = projectZones(
      [
        { lat: 21.3, lng: 81.6 },
        { lat: 21.2, lng: 81.7 },
      ],
      200,
      100,
      10,
    );
    expect(pts[0]).toEqual({ x: 10, y: 10 });
    expect(pts[1]).toEqual({ x: 190, y: 90 });
    expect(projectZones([{ lat: 21.3, lng: 81.6 }], 200, 100, 10)[0]).toEqual({ x: 100, y: 50 });
  });
});

describe('Jobs: pay is a monthly range in paise', () => {
  it('formats the range in rupees', () => {
    expect(payRangeText(1_200_000, 1_800_000)).toBe('₹12,000 – ₹18,000');
    expect(payRangeText(1_500_000, 1_500_000)).toBe('₹15,000');
  });
  it('reads whole rupees typed by the employer', () => {
    expect(rupeesToPaise('12000')).toBe(1_200_000);
    expect(rupeesToPaise(' 15,000 ')).toBe(1_500_000);
    expect(rupeesToPaise('12.5')).toBeNull();
    expect(rupeesToPaise('')).toBeNull();
    expect(rupeesToPaise('0')).toBeNull();
  });
});

interface Tree {
  [k: string]: string | Tree;
}
function keys(t: Tree, prefix = ''): string[] {
  return Object.entries(t).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`),
  );
}

describe('C + E copy exists in English and Hindi', () => {
  const u = (m: unknown) => (m as { ustaad: Tree }).ustaad;
  for (const ns of ['qa', 'learn', 'local', 'jobs', 'media', 'labels'] as const) {
    it(`ustaad.${ns} has the same keys in both languages and no empty value`, () => {
      const e = keys(u(en)[ns] as Tree);
      const h = keys(u(hi)[ns] as Tree);
      expect(e.length).toBeGreaterThan(5);
      expect(h.sort()).toEqual(e.sort());
      for (const k of h) expect(k.length).toBeGreaterThan(0);
    });
  }
  it('the confirm button reads यही मेरा गैराज है in Hindi', () => {
    expect((u(hi).local as Tree).confirm).toBe('यही मेरा गैराज है');
  });
  it('the anti-scam line is on the jobs screens in both languages', () => {
    expect((u(en).jobs as Tree).scam).toContain('never asks for money');
    expect((u(hi).jobs as Tree).scam).toContain('पैसे नहीं');
  });
});
