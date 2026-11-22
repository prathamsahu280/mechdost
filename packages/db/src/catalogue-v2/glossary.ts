/**
 * Hindi for the catalogue-v2 import (design 2026-11-22, hard rule 10). There is no translation service here, so
 * Hindi is made from a reviewed glossary: product and brand names, model codes, units and part numbers stay in Latin
 * (allowed on `/hi`); category words, oil types, tyre and battery terms are translated. Everything made this way is
 * flagged `products.hindi_machine` and shows up in Admin → Catalogue → "Missing Hindi / machine" for a human review.
 * Long marketing descriptions are NOT machine-translated word by word (that reads as nonsense): they come from an
 * optional `--translations` file (`{ "<English text>": "<Hindi text>" }`) and are otherwise left to the admin.
 */

/** Whole words, matched case-insensitively; the replacement is used as is. Order does not matter (longest first). */
const WORDS: readonly (readonly [string, string])[] = [
  ['engine oil', 'इंजन ऑयल'],
  ['engine oils', 'इंजन ऑयल'],
  ['gear oil', 'गियर ऑयल'],
  ['gear oils', 'गियर ऑयल'],
  ['brake fluid', 'ब्रेक फ्लूइड'],
  ['fork oil', 'फ़ोर्क ऑयल'],
  ['hydraulic oil', 'हाइड्रोलिक ऑयल'],
  ['transmission fluid', 'ट्रांसमिशन फ्लूइड'],
  ['transmission fluids', 'ट्रांसमिशन फ्लूइड'],
  ['cutting oil', 'कटिंग ऑयल'],
  ['motor oil', 'मोटर ऑयल'],
  ['motor oils', 'मोटर ऑयल'],
  ['fully synthetic', 'पूरी तरह सिंथेटिक'],
  ['semi synthetic', 'सेमी सिंथेटिक'],
  ['semi-synthetic', 'सेमी-सिंथेटिक'],
  ['synthetic', 'सिंथेटिक'],
  ['mineral', 'मिनरल'],
  ['diesel', 'डीज़ल'],
  ['petrol', 'पेट्रोल'],
  ['engine', 'इंजन'],
  ['oil', 'ऑयल'],
  ['oils', 'ऑयल'],
  ['grease', 'ग्रीज़'],
  ['greases', 'ग्रीज़'],
  ['coolant', 'कूलेंट'],
  ['coolants', 'कूलेंट'],
  ['antifreeze', 'एंटीफ़्रीज़'],
  ['heavy duty', 'हेवी ड्यूटी'],
  ['tractor', 'ट्रैक्टर'],
  ['motorcycle', 'मोटरसाइकिल'],
  ['scooter', 'स्कूटर'],
  ['passenger car', 'पैसेंजर कार'],
  ['car', 'कार'],
  ['truck', 'ट्रक'],
  ['bus', 'बस'],
  ['battery', 'बैटरी'],
  ['batteries', 'बैटरी'],
  ['inverter', 'इन्वर्टर'],
  ['tyre', 'टायर'],
  ['tyres', 'टायर'],
  ['tube type', 'ट्यूब वाला'],
  ['tube', 'ट्यूब'],
  ['tubes', 'ट्यूब'],
  ['flap', 'फ़्लैप'],
  ['flaps', 'फ़्लैप'],
  ['filter', 'फ़िल्टर'],
  ['filters', 'फ़िल्टर'],
  ['air', 'एयर'],
  ['fuel', 'फ़्यूल'],
  ['hydraulic', 'हाइड्रोलिक'],
  ['polish', 'पॉलिश'],
  ['polishing compound', 'पॉलिशिंग कंपाउंड'],
  ['wax', 'वैक्स'],
  ['shampoo', 'शैम्पू'],
  ['cleaner', 'क्लीनर'],
  ['cleaners', 'क्लीनर'],
  ['spray', 'स्प्रे'],
  ['sprays', 'स्प्रे'],
  ['aerosol', 'एरोसोल'],
  ['cloth', 'कपड़ा'],
  ['cloths', 'कपड़े'],
  ['accessories', 'एक्सेसरीज़'],
  ['care', 'केयर'],
  ['coating', 'कोटिंग'],
  ['coatings', 'कोटिंग'],
  ['industrial', 'इंडस्ट्रियल'],
  ['agricultural', 'कृषि'],
  ['farm', 'खेती'],
  ['off-the-road', 'ऑफ़-द-रोड'],
  ['commercial', 'कमर्शियल'],
  ['light commercial', 'लाइट कमर्शियल'],
  ['three-wheeler', 'तिपहिया'],
  ['two-wheeler', 'दोपहिया'],
  ['and', 'और'],
  ['for', 'के लिए'],
  ['other', 'अन्य'],
  ['series', 'सीरीज़'],
  ['pack', 'पैक'],
  ['months', 'महीने'],
  ['month', 'महीना'],
  ['tubeless', 'ट्यूबलेस'],
  ['radial', 'रेडियल'],
  ['bias', 'बायस'],
  ['front', 'आगे'],
  ['rear', 'पीछे'],
];

const WORD_MAP = new Map(WORDS.map(([en, hi]) => [en, hi] as const));
const PHRASES = [...WORD_MAP.keys()].sort((a, b) => b.length - a.length);

/**
 * Replace the known English words and phrases of `text` with Hindi; everything else (brand, model, grade, code,
 * unit) is kept as is. Returns the text unchanged when nothing matched.
 */
export function hindiFromGlossary(text: string): string {
  let out = text;
  for (const phrase of PHRASES) {
    const hi = WORD_MAP.get(phrase);
    if (hi === undefined) continue;
    out = out.replace(new RegExp(`(^|[^A-Za-z0-9])${escapeRe(phrase)}(?![A-Za-z0-9])`, 'gi'), `$1${hi}`);
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Sub-category names, English and Hindi, by source category label (`k`) of each section. */
export const SUB_CATEGORIES: Readonly<
  Record<string, { slug: string; parent: string; name: string; nameHi: string }>
> = {
  // Lubricants
  'lub|Motorcycle Oil': {
    slug: 'motorcycle-oil',
    parent: 'lubricants',
    name: 'Motorcycle oil',
    nameHi: 'मोटरसाइकिल ऑयल',
  },
  'lub|Passenger Car Motor Oils': {
    slug: 'car-engine-oil',
    parent: 'lubricants',
    name: 'Car engine oil',
    nameHi: 'कार इंजन ऑयल',
  },
  'lub|Diesel Engine Oils': {
    slug: 'diesel-engine-oil',
    parent: 'lubricants',
    name: 'Diesel engine oil',
    nameHi: 'डीज़ल इंजन ऑयल',
  },
  'lub|Gear Oils / Transmission Fluids': {
    slug: 'gear-oils',
    parent: 'lubricants',
    name: 'Gear oils and transmission fluids',
    nameHi: 'गियर ऑयल और ट्रांसमिशन फ्लूइड',
  },
  'lub|Industrial Lubricants': {
    slug: 'industrial-lubricants',
    parent: 'lubricants',
    name: 'Industrial lubricants',
    nameHi: 'इंडस्ट्रियल लुब्रिकेंट',
  },
  'lub|Tractor / Agri Oils': {
    slug: 'tractor-agri-oils',
    parent: 'lubricants',
    name: 'Tractor and farm oils',
    nameHi: 'ट्रैक्टर और खेती के ऑयल',
  },
  'lub|Greases': { slug: 'greases', parent: 'lubricants', name: 'Greases', nameHi: 'ग्रीज़' },
  'lub|Coolants': { slug: 'coolants', parent: 'lubricants', name: 'Coolants', nameHi: 'कूलेंट' },
  'lub|Brake Fluid & Fork Oil': {
    slug: 'brake-fluid-fork-oil',
    parent: 'lubricants',
    name: 'Brake fluid and fork oil',
    nameHi: 'ब्रेक फ्लूइड और फ़ोर्क ऑयल',
  },
  'lub|Speciality Oils': {
    slug: 'speciality-oils',
    parent: 'lubricants',
    name: 'Speciality oils',
    nameHi: 'स्पेशलिटी ऑयल',
  },
  'lub|Heavy Duty': {
    slug: 'heavy-duty-oils',
    parent: 'lubricants',
    name: 'Heavy duty oils',
    nameHi: 'हेवी ड्यूटी ऑयल',
  },
  'lub|Auto Care Products': {
    slug: 'car-care-products',
    parent: 'accessories',
    name: 'Car care products',
    nameHi: 'कार केयर प्रोडक्ट',
  },
  // Batteries
  'bat|Car/SUV Battery': {
    slug: 'car-suv-batteries',
    parent: 'batteries',
    name: 'Car and SUV batteries',
    nameHi: 'कार और SUV बैटरी',
  },
  'bat|CV Battery': {
    slug: 'cv-batteries',
    parent: 'batteries',
    name: 'Truck and bus batteries',
    nameHi: 'ट्रक और बस बैटरी',
  },
  'bat|Inverter / UPS': {
    slug: 'inverter-ups',
    parent: 'batteries',
    name: 'Inverters and UPS',
    nameHi: 'इन्वर्टर और UPS',
  },
  'bat|Inverter Battery': {
    slug: 'inverter-batteries',
    parent: 'batteries',
    name: 'Inverter batteries',
    nameHi: 'इन्वर्टर बैटरी',
  },
  'bat|E-Rickshaw Battery': {
    slug: 'e-rickshaw-batteries',
    parent: 'batteries',
    name: 'E-rickshaw batteries',
    nameHi: 'ई-रिक्शा बैटरी',
  },
  'bat|EV Charger': {
    slug: 'ev-chargers',
    parent: 'ev-essentials',
    name: 'EV chargers',
    nameHi: 'EV चार्जर',
  },
  'bat|Tractor Battery': {
    slug: 'tractor-batteries',
    parent: 'batteries',
    name: 'Tractor batteries',
    nameHi: 'ट्रैक्टर बैटरी',
  },
  'bat|2-Wheeler Battery': {
    slug: 'two-wheeler-batteries',
    parent: 'batteries',
    name: 'Two-wheeler batteries',
    nameHi: 'दोपहिया बैटरी',
  },
  'bat|3-Wheeler Battery': {
    slug: 'three-wheeler-batteries',
    parent: 'batteries',
    name: 'Three-wheeler batteries',
    nameHi: 'तिपहिया बैटरी',
  },
  'bat|Genset Battery': {
    slug: 'genset-batteries',
    parent: 'batteries',
    name: 'Genset batteries',
    nameHi: 'जेनसेट बैटरी',
  },
  'bat|Lithium-ion Cell/Pack': {
    slug: 'lithium-batteries',
    parent: 'batteries',
    name: 'Lithium-ion cells and packs',
    nameHi: 'लिथियम-आयन सेल और पैक',
  },
  'bat|Power Electronics': {
    slug: 'power-electronics',
    parent: 'batteries',
    name: 'Power electronics',
    nameHi: 'पावर इलेक्ट्रॉनिक्स',
  },
  'bat|Battery Accessories': {
    slug: 'battery-accessories',
    parent: 'batteries',
    name: 'Battery accessories',
    nameHi: 'बैटरी एक्सेसरीज़',
  },
  'bat|Brand range (names only)': {
    slug: 'brand-ranges',
    parent: 'batteries',
    name: 'Brand ranges',
    nameHi: 'ब्रांड रेंज',
  },
  'bat|Lubricants': {
    slug: 'speciality-oils',
    parent: 'lubricants',
    name: 'Speciality oils',
    nameHi: 'स्पेशलिटी ऑयल',
  },
  'bat|Solar': {
    slug: 'solar-batteries',
    parent: 'batteries',
    name: 'Solar batteries',
    nameHi: 'सोलर बैटरी',
  },
  // Auto care (KELVINN, CERAFENCE)
  'car|Aerosol Sprays': {
    slug: 'aerosol-sprays',
    parent: 'accessories',
    name: 'Aerosol sprays',
    nameHi: 'एरोसोल स्प्रे',
  },
  'car|Cleaners & Shampoos': {
    slug: 'cleaners-shampoos',
    parent: 'accessories',
    name: 'Cleaners and shampoos',
    nameHi: 'क्लीनर और शैम्पू',
  },
  'car|Polishes & Waxes': {
    slug: 'polishes-waxes',
    parent: 'accessories',
    name: 'Polishes and waxes',
    nameHi: 'पॉलिश और वैक्स',
  },
  'car|Cloths & Accessories': {
    slug: 'cloths-accessories',
    parent: 'accessories',
    name: 'Cloths and accessories',
    nameHi: 'कपड़े और एक्सेसरीज़',
  },
  'car|Coatings': { slug: 'coatings', parent: 'accessories', name: 'Coatings', nameHi: 'कोटिंग' },
  'car|Greases & Lubricants': {
    slug: 'care-greases',
    parent: 'accessories',
    name: 'Greases and lubricant sprays',
    nameHi: 'ग्रीज़ और लुब्रिकेंट स्प्रे',
  },
  // Tyres
  'tyr|Farm/Agricultural': {
    slug: 'farm-tyres',
    parent: 'tyres',
    name: 'Farm tyres',
    nameHi: 'खेती के टायर',
  },
  'tyr|Off-the-Road/Industrial': {
    slug: 'otr-industrial-tyres',
    parent: 'tyres',
    name: 'Off-the-road and industrial tyres',
    nameHi: 'ऑफ़-द-रोड और इंडस्ट्रियल टायर',
  },
  'tyr|Truck & Bus': {
    slug: 'truck-bus-tyres',
    parent: 'tyres',
    name: 'Truck and bus tyres',
    nameHi: 'ट्रक और बस टायर',
  },
  'tyr|Two-Wheeler (Motorcycle/Scooter)': {
    slug: 'two-wheeler-tyres',
    parent: 'tyres',
    name: 'Two-wheeler tyres',
    nameHi: 'दोपहिया टायर',
  },
  'tyr|Two-Wheeler (Motorcycle)': {
    slug: 'two-wheeler-tyres',
    parent: 'tyres',
    name: 'Two-wheeler tyres',
    nameHi: 'दोपहिया टायर',
  },
  'tyr|Two-Wheeler (Scooter)': {
    slug: 'two-wheeler-tyres',
    parent: 'tyres',
    name: 'Two-wheeler tyres',
    nameHi: 'दोपहिया टायर',
  },
  'tyr|Passenger Car': { slug: 'car-tyres', parent: 'tyres', name: 'Car tyres', nameHi: 'कार टायर' },
  'tyr|Light Commercial': {
    slug: 'light-commercial-tyres',
    parent: 'tyres',
    name: 'Light commercial tyres',
    nameHi: 'लाइट कमर्शियल टायर',
  },
  'tyr|Tubes & Flaps': {
    slug: 'tubes-flaps',
    parent: 'tyres',
    name: 'Tubes and flaps',
    nameHi: 'ट्यूब और फ़्लैप',
  },
  'tyr|SUV/4x4': { slug: 'suv-tyres', parent: 'tyres', name: 'SUV and 4x4 tyres', nameHi: 'SUV और 4x4 टायर' },
  'tyr|Three-Wheeler': {
    slug: 'three-wheeler-tyres',
    parent: 'tyres',
    name: 'Three-wheeler tyres',
    nameHi: 'तिपहिया टायर',
  },
  'tyr|Other': { slug: 'other-tyres', parent: 'tyres', name: 'Other tyres', nameHi: 'अन्य टायर' },
  // Filters
  'flt|Air Filter': { slug: 'air-filters', parent: 'filters', name: 'Air filters', nameHi: 'एयर फ़िल्टर' },
  'flt|Fuel Filter': {
    slug: 'fuel-filters',
    parent: 'filters',
    name: 'Fuel filters',
    nameHi: 'फ़्यूल फ़िल्टर',
  },
  'flt|Oil Filter': { slug: 'oil-filters', parent: 'filters', name: 'Oil filters', nameHi: 'ऑयल फ़िल्टर' },
  'flt|Other Filter': {
    slug: 'other-filters',
    parent: 'filters',
    name: 'Other filters',
    nameHi: 'अन्य फ़िल्टर',
  },
  'flt|Hydraulic Filter': {
    slug: 'hydraulic-filters',
    parent: 'filters',
    name: 'Hydraulic filters',
    nameHi: 'हाइड्रोलिक फ़िल्टर',
  },
  'flt|Coolant Filter': {
    slug: 'coolant-filters',
    parent: 'filters',
    name: 'Coolant filters',
    nameHi: 'कूलेंट फ़िल्टर',
  },
};

/** Words of the highlight lines (`Key: value`), by source spec key (lower case). */
export const SPEC_KEYS_HI: Readonly<Record<string, string>> = {
  grade: 'ग्रेड',
  api: 'API',
  'oil type': 'ऑयल टाइप',
  application: 'उपयोग',
  segment: 'सेगमेंट',
  warranty: 'वारंटी',
  'series warranty': 'सीरीज़ वारंटी',
  voltage: 'वोल्टेज',
  ah: 'Ah',
  cca: 'CCA',
  rim: 'रिम',
  'ply rating': 'प्लाई रेटिंग',
  'tube type': 'ट्यूब टाइप',
  construction: 'बनावट',
  fitment: 'फ़िटमेंट',
  'load index': 'लोड इंडेक्स',
  'speed rating': 'स्पीड रेटिंग',
  type: 'टाइप',
  position: 'पोज़िशन',
};
