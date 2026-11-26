/**
 * Reserved and confusable display names (spec 23 § 14a SR-4, AT-NAME-1; plan task B3). Pure and dependency-free.
 *
 * `nameSkeleton()` follows the UTS #39 "skeleton" idea for the scripts members write in (Latin, Devanagari, plus the
 * Cyrillic and Greek letters people use to fake Latin ones): NFKC, lower case, accents and the Devanagari nukta
 * removed, look-alike letters and digits mapped to one Latin letter, joiners, spaces and punctuation dropped. It is a
 * curated subset of the Unicode confusables table (no new dependency; decision 2026-11-26 "workstream B round 3"):
 * the full table maps thousands of symbols nobody types on an Indian phone keyboard. Two names with the same skeleton
 * read the same, so a reserved skeleton refuses every look-alike of it.
 *
 * Server-only in practice (the API and repositories call it); the web never imports this module, so the table stays
 * out of the browser bundle.
 */

/** Look-alike letters → the Latin letter they imitate (lower case; applied after case folding). */
const CONFUSABLE: Readonly<Record<string, string>> = {
  // Cyrillic
  а: 'a',
  в: 'b',
  е: 'e',
  ё: 'e',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
  і: 'i',
  ї: 'i',
  ј: 'j',
  ѕ: 's',
  һ: 'h',
  ԁ: 'd',
  ԛ: 'q',
  ԝ: 'w',
  ӏ: 'l',
  // Greek
  α: 'a',
  β: 'b',
  ε: 'e',
  η: 'n',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  γ: 'y',
  ω: 'w',
  // Latin letters that do not decompose
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  ħ: 'h',
  ı: 'i',
  ȷ: 'j',
  ŀ: 'l',
  ƒ: 'f',
  ɡ: 'g',
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  // Digits and symbols used as letters
  '0': 'o',
  '1': 'l',
  '|': 'l',
  $: 's',
};

/** Letter pairs that read as one letter (UTS #39 maps "rn" to "m"). */
const PAIRS: readonly (readonly [RegExp, string])[] = [
  [/rn/g, 'm'],
  [/vv/g, 'w'],
];

/** Combining accents (Latin, Greek, Cyrillic) and the Devanagari nukta; vowel signs stay (they change the word). */
const ACCENTS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-़︯]/g;

/** Any decimal digit in any script → its ASCII digit (Devanagari ६ → 6) before the look-alike map. */
function asciiDigits(s: string): string {
  return s.replace(/\p{Nd}/gu, (d) => {
    const cp = d.codePointAt(0) ?? 0;
    // Unicode decimal digits come in runs of ten (0…9): walk back to the run's zero.
    let zero = cp;
    while (zero > cp - 9 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero -= 1;
    return String(cp - zero);
  });
}

/** One run of text → its skeleton (letters, digits and Devanagari signs only). */
export function nameSkeleton(name: string): string {
  let s = asciiDigits(name.normalize('NFKC').toLowerCase()).normalize('NFD').replace(ACCENTS, '');
  s = [...s].map((ch) => CONFUSABLE[ch] ?? ch).join('');
  // Drop everything that is not a letter, digit or (Devanagari) sign: spaces, punctuation, joiners, controls.
  s = s.replace(/[^\p{L}\p{N}\p{M}]/gu, '');
  for (const [re, to] of PAIRS) s = s.replace(re, to);
  return s.normalize('NFC');
}

/** Reserved skeletons this long or longer are refused anywhere inside a name ("MechDostOfficial"). */
const SUBSTRING_MIN = 6;

/**
 * True when the name (or any run of its words) has a reserved skeleton. Short reserved words ("admin", "staff") match
 * only as whole words, so "Badmin Singh" stays allowed; longer ones ("mechdost", "moderator") match anywhere.
 */
export function isReservedName(name: string, reservedSkeletons: ReadonlySet<string>): boolean {
  if (reservedSkeletons.size === 0) return false;
  const whole = nameSkeleton(name);
  if (reservedSkeletons.has(whole)) return true;
  for (const r of reservedSkeletons) if (r.length >= SUBSTRING_MIN && whole.includes(r)) return true;
  const words = name
    .normalize('NFKC')
    .split(/[^\p{L}\p{N}\p{M}\u200c\u200d$|]+/u)
    .map(nameSkeleton)
    .filter((w) => w.length > 0);
  for (let i = 0; i < words.length; i += 1) {
    let run = '';
    for (let j = i; j < words.length; j += 1) {
      run += words[j];
      if (reservedSkeletons.has(run)) return true;
    }
  }
  return false;
}

export type DisplayNameRefusal = 'NAME_CONTACT' | 'NAME_FORMAT';

/** Bidi overrides and other invisible format characters; ZWJ/ZWNJ stay allowed (Devanagari conjuncts use them). */
const HIDDEN = /[\p{Cc}\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/u;
const LINK = /(?:https?:|www\.|\.(?:com|in|net|org|co|io|me|app|xyz|info|link)\b)/iu;

/**
 * Display-name rules (spec 23 § 8 `PATCH /ustaad/me`, SR-34): a name never carries contact details (a phone number,
 * a link, an email or an @handle: those go through messages, never the card), has at least one letter and no hidden
 * format characters.
 */
export function displayNameRefusal(name: string): DisplayNameRefusal | null {
  const n = name.normalize('NFKC');
  if (HIDDEN.test(n) || !/\p{L}/u.test(n)) return 'NAME_FORMAT';
  const digits = asciiDigits(n).replace(/\D/g, '');
  if (digits.length >= 6 || n.includes('@') || LINK.test(n)) return 'NAME_CONTACT';
  return null;
}

/**
 * Seed list (migration `0098_ustaad_identity_b3`, `ustaad_reserved_names`): the brand, the operator and staff role
 * words, in Latin and Devanagari. Admin adds more (staff names, partner brands) under Admin › Network settings.
 * "Ustaad" alone is not reserved: members call themselves Ustaad.
 */
export const RESERVED_NAME_SEED: readonly string[] = [
  'MechDost',
  'MechDost Support',
  'MechDost Team',
  'MechDost Official',
  'मेकदोस्त',
  'मैकदोस्त',
  'Admin',
  'Administrator',
  'Moderator',
  'Support',
  'Staff',
  'Official',
  'Helpdesk',
  'Customer Care',
  'Community Manager',
  'Ustaad Network',
  'Ustaad Official',
  'Ustaad Team',
  'Shourya Integrated',
  'एडमिन',
  'सपोर्ट',
  'मॉडरेटर',
  'ऑफिशियल',
  'उस्ताद नेटवर्क',
];
