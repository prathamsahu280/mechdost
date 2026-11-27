/**
 * Ustaad Network starter lists (SIM-P2/G16, SIM-P16/G18, live QA 2026-11-27): curated work hashtags and the first
 * Banned words, Personal details to hide and Blocked link sites, so the network does not launch with empty lists.
 * Everything stays editable in Admin → Ustaad (hard rule 8). The seed only ADDS rows: an existing tag slug or list
 * phrase (whatever an admin did to it, including switching it off) is left exactly as it is, and nothing is deleted.
 * The banned list is a starter for founder/legal review (common Hindi, Hinglish and English abuse in Devanagari and
 * Latin spellings); short or ambiguous words are left out to avoid holding ordinary posts.
 * Run on a database: `pnpm db:seed:ustaad-starter [--dry-run]` (docs/runbooks/ustaad.md).
 */
import { normaliseUstaadPhrase } from '@mechdost/shared/ustaad/admin-rules';
import type { TAG_GROUPS } from '@mechdost/shared/ustaad/codes';
import { ustaadTags, ustaadWordLists } from '../schema';
import type { Tx } from '../repo/orders';

type Lang = 'any' | 'hi' | 'en' | 'hinglish';
interface StarterTag {
  slug: string;
  nameEn: string;
  nameHi: string;
  group: (typeof TAG_GROUPS)[number];
  aliases: string[];
}
interface StarterWord {
  phrase: string;
  lang: Lang;
}

const words = (lang: Lang, list: string[]): StarterWord[] => list.map((phrase) => ({ phrase, lang }));

export const USTAAD_STARTER = {
  tags: [
    {
      slug: 'battery',
      nameEn: 'Battery',
      nameHi: 'बैटरी',
      group: 'part',
      aliases: ['battri', 'batri', 'बैट्री'],
    },
    {
      slug: 'selfstart',
      nameEn: 'Self start',
      nameHi: 'सेल्फ स्टार्ट',
      group: 'repair',
      aliases: ['self', 'starter', 'सेल्फ'],
    },
    {
      slug: 'wiring',
      nameEn: 'Wiring',
      nameHi: 'वायरिंग',
      group: 'repair',
      aliases: ['wire', 'electrical', 'बिजली'],
    },
    {
      slug: 'clutch',
      nameEn: 'Clutch',
      nameHi: 'क्लच',
      group: 'part',
      aliases: ['clutchplate', 'clutch plate', 'क्लच प्लेट'],
    },
    {
      slug: 'brakes',
      nameEn: 'Brakes',
      nameHi: 'ब्रेक',
      group: 'part',
      aliases: ['brake', 'brake pad', 'ब्रेक पैड'],
    },
    {
      slug: 'engine',
      nameEn: 'Engine',
      nameHi: 'इंजन',
      group: 'repair',
      aliases: ['engin', 'injan', 'इंजिन'],
    },
    {
      slug: 'mileage',
      nameEn: 'Mileage',
      nameHi: 'माइलेज',
      group: 'repair',
      aliases: ['average', 'avg', 'एवरेज'],
    },
    {
      slug: 'ac',
      nameEn: 'Car AC',
      nameHi: 'कार एसी',
      group: 'repair',
      aliases: ['aircon', 'ac gas', 'एसी'],
    },
    {
      slug: 'ev',
      nameEn: 'Electric vehicle',
      nameHi: 'इलेक्ट्रिक गाड़ी',
      group: 'vehicle_model',
      aliases: ['electric', 'e-rickshaw', 'ई रिक्शा'],
    },
    {
      slug: 'tyre',
      nameEn: 'Tyres and puncture',
      nameHi: 'टायर और पंचर',
      group: 'part',
      aliases: ['tyres', 'tire', 'puncture', 'पंचर'],
    },
    {
      slug: 'service',
      nameEn: 'General service',
      nameHi: 'जनरल सर्विस',
      group: 'repair',
      aliases: ['servicing', 'oil change', 'सर्विसिंग'],
    },
  ] satisfies StarterTag[],
  banned: [
    ...words('hinglish', [
      'madarchod',
      'maderchod',
      'madarchodd',
      'behenchod',
      'bhenchod',
      'behanchod',
      'chutiya',
      'chutiye',
      'chootiya',
      'gandu',
      'gaandu',
      'randi',
      'harami',
      'haramzada',
      'haramzade',
      'bhosdike',
      'bhosdi ke',
      'bhosadike',
      'lauda',
      'lavda',
      'jhaatu',
      'jhatu',
      'kamina',
      'kutte ki aulad',
    ]),
    ...words('hi', [
      'मादरचोद',
      'बहनचोद',
      'बहेनचोद',
      'भेनचोद',
      'चूतिया',
      'चुतिया',
      'चूतिये',
      'गांडू',
      'गाण्डू',
      'रंडी',
      'हरामी',
      'हरामज़ादा',
      'हरामजादा',
      'भोसड़ीके',
      'भोसडीके',
      'लौड़ा',
      'लौडा',
      'झाटू',
      'कमीना',
      'कुत्ते की औलाद',
    ]),
    ...words('en', ['fuck', 'fucker', 'motherfucker', 'bitch', 'asshole', 'cunt', 'slut', 'whore']),
  ],
  piiPattern: [
    ...words('hinglish', [
      'mera number',
      'mera no',
      'call karo',
      'whatsapp karo',
      'aadhaar number',
      'pan number',
    ]),
    ...words('en', ['my number', 'call me on', 'whatsapp me', 'bank account number', 'ifsc', 'otp']),
    ...words('hi', ['मेरा नंबर', 'कॉल करो', 'आधार नंबर', 'खाता नंबर']),
  ],
  linkDomain: words('any', [
    'bit.ly',
    'tinyurl.com',
    'goo.gl',
    'rb.gy',
    'cutt.ly',
    'is.gd',
    'shorturl.at',
    't.me',
    'telegram.me',
    'grabify.link',
    'iplogger.org',
  ]),
} as const;

/** Adds the starter rows that are missing; returns how many were added. */
export async function seedUstaadStarterLists(db: Tx): Promise<{ tags: number; words: number }> {
  const tags = await db
    .insert(ustaadTags)
    .values(USTAAD_STARTER.tags.map((t) => ({ ...t, aliases: t.aliases.map(normaliseUstaadPhrase) })))
    .onConflictDoNothing({ target: ustaadTags.slug })
    .returning({ id: ustaadTags.id });
  const rows = [
    ...USTAAD_STARTER.banned.map((w) => ({ ...w, list: 'banned' as const })),
    ...USTAAD_STARTER.piiPattern.map((w) => ({ ...w, list: 'pii_pattern' as const })),
    ...USTAAD_STARTER.linkDomain.map((w) => ({ ...w, list: 'link_domain' as const })),
  ].map((w) => ({
    list: w.list,
    phrase: w.phrase,
    phraseNorm: normaliseUstaadPhrase(w.phrase),
    lang: w.lang,
  }));
  const added = await db
    .insert(ustaadWordLists)
    .values(rows)
    .onConflictDoNothing({ target: [ustaadWordLists.list, ustaadWordLists.phraseNorm] })
    .returning({ id: ustaadWordLists.id });
  return { tags: tags.length, words: added.length };
}
