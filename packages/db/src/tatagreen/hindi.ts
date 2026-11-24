/**
 * Hindi for the Tata Green import (hard rule 10). Brand, range and model names stay in Latin script
 * (`packages/shared/src/catalogue-hindi.ts`); everything else is Devanagari. Tata Green's CSV has no feature lines, so
 * the dictionary is only the generic words that occur in a product or range name.
 */

/** Generic words of a Tata Green name that have a Hindi word; the rest are the maker's own names or codes. */
export const NAME_WORDS_HI: Readonly<Record<string, string>> = {
  plus: 'प्लस',
  lithium: 'लिथियम',
  switch: 'स्विच',
  on: 'ऑन',
  industrial: 'इंडस्ट्रियल',
  'co-branded': 'को-ब्रांडेड',
  commercial: 'कमर्शियल',
  vehicle: 'व्हीकल',
  battery: 'बैटरी',
};

/**
 * The ranges of the source (its "Range" column holds one pseudo-range per model for the TG and SLV models) grouped the
 * way Tata Green's own names read, with the Hindi form of the name after the brand.
 */
export const RANGES: Readonly<Record<string, { en: string; hi: string }>> = {
  premio: { en: 'Premio', hi: 'Premio' },
  slv: { en: 'SLV', hi: 'SLV' },
  slv600r: { en: 'SLV', hi: 'SLV' },
  slv600l: { en: 'SLV', hi: 'SLV' },
  tg400l: { en: 'TG', hi: 'TG' },
  tg350l: { en: 'TG', hi: 'TG' },
  tg350r: { en: 'TG', hi: 'TG' },
  tg550l: { en: 'TG', hi: 'TG' },
  tg550r: { en: 'TG', hi: 'TG' },
  tg700l: { en: 'TG', hi: 'TG' },
  tg700r: { en: 'TG', hi: 'TG' },
  tg800r: { en: 'TG', hi: 'TG' },
  tgx: { en: 'TGX', hi: 'TGX' },
  velocity: { en: 'Velocity', hi: 'Velocity' },
  'velocity plus': { en: 'Velocity Plus', hi: 'Velocity प्लस' },
  jeevan: { en: 'Jeevan', hi: 'Jeevan' },
  roadstar: { en: 'Roadstar', hi: 'Roadstar' },
  'sawaar-e lithium': { en: 'Sawaar-e Lithium', hi: 'Sawaar-e लिथियम' },
  '105e41r genstar': { en: 'Genstar', hi: 'Genstar' },
  tgi: { en: 'TGI', hi: 'TGI' },
  'switch on': { en: 'Switch On', hi: 'स्विच ऑन' },
  switchon: { en: 'SwitchOn', hi: 'SwitchOn' },
  'switchon tgups': { en: 'SwitchOn', hi: 'SwitchOn' },
};
