import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json';
import hi from '../src/i18n/hi.json';
import { devicePlaceText, gstStateCodeOf, parseUserAgent } from '../src/devices';

const UA = {
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  chromeAndroidTablet:
    'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1',
  safariIpad:
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  operaWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.0',
  safariMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

describe('parseUserAgent', () => {
  it.each([
    [UA.chromeAndroid, { deviceKind: 'mobile', browser: 'chrome', os: 'android' }],
    [UA.chromeAndroidTablet, { deviceKind: 'tablet', browser: 'chrome', os: 'android' }],
    [UA.safariIphone, { deviceKind: 'mobile', browser: 'safari', os: 'ios' }],
    [UA.chromeIphone, { deviceKind: 'mobile', browser: 'chrome', os: 'ios' }],
    [UA.safariIpad, { deviceKind: 'tablet', browser: 'safari', os: 'ios' }],
    [UA.edgeWindows, { deviceKind: 'desktop', browser: 'edge', os: 'windows' }],
    [UA.firefoxLinux, { deviceKind: 'desktop', browser: 'firefox', os: 'linux' }],
    [UA.samsung, { deviceKind: 'mobile', browser: 'samsung', os: 'android' }],
    [UA.operaWindows, { deviceKind: 'desktop', browser: 'opera', os: 'windows' }],
    [UA.safariMac, { deviceKind: 'desktop', browser: 'safari', os: 'macos' }],
    [UA.chromeMac, { deviceKind: 'desktop', browser: 'chrome', os: 'macos' }],
  ])('reads %s', (ua, expected) => {
    expect(parseUserAgent(ua)).toEqual(expected);
  });

  it('answers other for nothing, nonsense and curl', () => {
    for (const ua of [undefined, null, '', 'curl/8.4.0', 'x'.repeat(5000)])
      expect(parseUserAgent(ua)).toEqual({ deviceKind: 'other', browser: 'other', os: 'other' });
  });
});

describe('gstStateCodeOf', () => {
  it('maps the IP database spellings to the GST code', () => {
    expect(gstStateCodeOf('Chhattisgarh')).toBe('22');
    expect(gstStateCodeOf('Orissa')).toBe('21');
    expect(gstStateCodeOf('National Capital Territory of Delhi')).toBe('07');
    expect(gstStateCodeOf('  maharashtra ')).toBe('27');
    expect(gstStateCodeOf('Bavaria')).toBeNull();
    expect(gstStateCodeOf(null)).toBeNull();
  });
  it('every code has a Hindi and an English name in the locale files', () => {
    for (const code of ['01', '07', '21', '22', '27', '36', '38']) {
      expect((hi.gstStates as Record<string, string>)[code]).toBeTruthy();
      expect((en.gstStates as Record<string, string>)[code]).toBeTruthy();
    }
  });
});

describe('devicePlaceText', () => {
  const full = { region: 'Chhattisgarh', gstStateCode: '22', city: 'Raipur', cityHi: 'रायपुर' };
  const hiStates = hi.gstStates as Record<string, string>;
  it('English: city and state', () => {
    expect(devicePlaceText('en', full, hiStates)).toBe('Raipur, Chhattisgarh');
  });
  it('Hindi: Hindi city and Hindi state', () => {
    expect(devicePlaceText('hi', full, hiStates)).toBe('रायपुर, छत्तीसगढ़');
  });
  it('no city: state only', () => {
    expect(devicePlaceText('en', { ...full, city: null, cityHi: null }, hiStates)).toBe('Chhattisgarh');
    expect(devicePlaceText('hi', { ...full, city: null, cityHi: null }, hiStates)).toBe('छत्तीसगढ़');
  });
  it('Hindi never shows an English city: a city without a Hindi name is left out', () => {
    expect(devicePlaceText('hi', { ...full, city: 'Korba', cityHi: null }, hiStates)).toBe('छत्तीसगढ़');
  });
  it('Hindi: a region that is not an Indian state is left out entirely', () => {
    expect(
      devicePlaceText(
        'hi',
        { region: 'Bavaria', gstStateCode: null, city: 'Munich', cityHi: null },
        hiStates,
      ),
    ).toBeNull();
  });
  it('no match: nothing', () => {
    expect(devicePlaceText('en', null, hiStates)).toBeNull();
    expect(
      devicePlaceText('en', { region: null, gstStateCode: null, city: null, cityHi: null }, hiStates),
    ).toBeNull();
  });
});
