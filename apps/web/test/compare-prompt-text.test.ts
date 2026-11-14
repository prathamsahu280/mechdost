import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { nameIn, switchText, type SwitchLabels } from '../src/lib/compare/prompt-text';

/**
 * The tray's question (redesign 2026-11-14): "Start a new comparison with Batteries? This removes 1 Lubricants
 * item." in both languages, from the real locale files with the placeholders the layout leaves in.
 */
function labels(c: typeof en.compare): SwitchLabels {
  return {
    switchTitle: c.switchTitle,
    switchTitleNoName: c.switchTitleNoName,
    switchOne: c.switchOne,
    switchMany: c.switchMany,
    switchOneNoName: c.switchOneNoName,
    switchManyNoName: c.switchManyNoName,
  };
}

const ask = (over: Partial<Parameters<typeof switchText>[0]> = {}) => ({
  kind: 'switch' as const,
  slug: 'exide-xltz4a-2w-battery',
  category: 'batteries',
  from: 'lubricants',
  name: 'Batteries',
  lang: 'en',
  fromName: 'Lubricants',
  fromLang: 'en',
  fromCount: 1,
  ...over,
});

describe('compare tray question wording', () => {
  it('names both categories and the count (the wording the user asked for)', () => {
    expect(switchText(ask(), labels(en.compare), 'en')).toEqual({
      title: 'Start a new comparison with Batteries?',
      body: 'This removes 1 Lubricants item.',
    });
    expect(switchText(ask({ fromCount: 3 }), labels(en.compare), 'en').body).toBe(
      'This removes 3 Lubricants items.',
    );
  });

  it('is all Hindi on /hi (only the digit is Latin)', () => {
    const t = switchText(
      ask({ name: 'बैटरी', lang: 'hi', fromName: 'लुब्रिकेंट', fromLang: 'hi', fromCount: 2 }),
      labels(hi.compare),
      'hi',
    );
    expect(t.title).toBe('बैटरी के साथ नई तुलना शुरू करें?');
    expect(t.body).toBe('इससे लुब्रिकेंट के 2 आइटम हट जाएँगे।');
    expect(`${t.title} ${t.body}`).not.toMatch(/[A-Za-z]/);
  });

  it('never shows a name stored in another language (English list, Hindi page)', () => {
    const t = switchText(ask({ name: 'बैटरी', lang: 'hi' }), labels(hi.compare), 'hi');
    expect(t.title).toBe('बैटरी के साथ नई तुलना शुरू करें?');
    expect(t.body).toBe('इससे आपका चुना हुआ प्रोडक्ट हट जाएगा।');
    expect(switchText(ask({ name: undefined, fromCount: 2 }), labels(en.compare), 'en')).toEqual({
      title: 'Start a new comparison?',
      body: 'This removes 2 Lubricants items.',
    });
    expect(
      switchText(ask({ fromName: undefined, fromLang: undefined, fromCount: 4 }), labels(en.compare), 'en')
        .body,
    ).toBe('This removes the 4 products you picked.');
  });

  it('treats names as text, not replacement patterns', () => {
    expect(switchText(ask({ name: 'A $& B' }), labels(en.compare), 'en').title).toBe(
      'Start a new comparison with A $& B?',
    );
  });

  it('nameIn needs a name and a matching language', () => {
    expect(nameIn('Lubricants', 'en', 'en')).toBe('Lubricants');
    expect(nameIn('Lubricants', 'en', 'hi')).toBeNull();
    expect(nameIn(undefined, 'en', 'en')).toBeNull();
  });
});
