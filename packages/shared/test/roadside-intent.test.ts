import { describe, expect, it } from 'vitest';
import { matchesRoadsideIntent } from '../src/search/roadside-intent';

describe('matchesRoadsideIntent (a search that means "stuck on the road")', () => {
  it.each([
    'roadside',
    'Roadside help',
    'towing',
    'tow',
    'tow truck near me',
    'puncture',
    'flat tyre',
    'flat tire',
    'battery dead',
    'dead battery',
    'breakdown',
    'my car broke down',
    'stuck',
    'sos',
    'jump start',
    'gaadi kharab',
    'रोडसाइड',
    'टोइंग',
    'पंक्चर',
    'पंचर',
    'टायर पंक्चर',
    'बैटरी डेड',
    'गाड़ी खराब',
    'स्टार्ट नहीं हो रही',
    'सड़क पर फँस गए',
    'गाड़ी खराब', // nukta typed as a separate mark
    'ख़राब गाड़ी',
  ])('matches %s', (q) => {
    expect(matchesRoadsideIntent(q)).toBe(true);
  });

  it('matches however a nukta letter was typed (NFC)', () => {
    expect(matchesRoadsideIntent('गाड़ी खराब')).toBe(true); // precomposed ड़ (U+095C)
    expect(matchesRoadsideIntent('गाड़ी खराब')).toBe(true); // ड + nukta
    expect(matchesRoadsideIntent('ख़राब गाड़ी')).toBe(true);
  });

  it.each([
    '',
    '   ',
    'tower light',
    'stuckup',
    'battery',
    'amaron battery 12v',
    'tyre 90/90-17',
    '20W-40 bike oil',
    'engine oil',
    'बैटरी',
    'इंजन ऑयल',
    'brake pad',
  ])('does not match %s', (q) => {
    expect(matchesRoadsideIntent(q)).toBe(false);
  });
});
