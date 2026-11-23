/**
 * Which Latin-script words may stay in the Hindi text of the imported catalogue (hard rule 10, user 2026-11-02:
 * "brand and model names, units, codes"). Everything else must be Devanagari. Used by the importer's dry run, the
 * unit test over `docs/catalogue/catalogue-v2-translations-hi.json` and (as extra phrases) the web's
 * `latinOffenders` check.
 *
 * Add a word here only when it is a brand, a product-series or model name the maker coined, or a standard / acronym
 * people read in Latin script. A generic word ("cleaner", "polish", "oil") is translated instead.
 */
const BRANDS = [
  'Castrol',
  'Gulf',
  'Exide',
  'Amaron',
  'Tata',
  'Green',
  'Motors',
  'Mahindra',
  'Kelvinn',
  'Cerafence',
  'Elvi',
];

/** Product series and model names (coined by the makers; the import's brands are the price-list brands). */
const SERIES = [
  'Activ',
  'Adv',
  'AGMi',
  'Agri',
  'Cargo',
  'Crb',
  'Crown',
  'Dare',
  'Distillo',
  'Drive',
  'Dura',
  'Duramax',
  'Edge',
  'Eezy',
  'Eko',
  'Elite',
  'Endura',
  'Epiq',
  'Eride',
  'Essential',
  'Eurocool',
  'Fleet',
  'Formula',
  'Genstar',
  'Glide',
  'Gtx',
  'Guard',
  'Hkva',
  'Hups',
  'Iss',
  'Jai',
  'Jeevan',
  'Kisan',
  'Klene',
  'Klener',
  'Kool',
  'Longlife',
  'Magnatec',
  'Matrix',
  'Max',
  'Mgo',
  'Mileage',
  'Multi',
  'Multipro',
  'Nxg',
  'NxG',
  'MultiPro',
  'Plus',
  'Power',
  'Premio',
  'Pride',
  'Prima',
  'Pro',
  'Radicool',
  'Ride',
  'Roadstar',
  'Slv',
  'Special',
  'Spheerol',
  'Spl',
  'Superfleet',
  'Supreme',
  'Super',
  'Switchon',
  'Syntrac',
  'Tmgo',
  'Trans',
  'Transmax',
  'Turbo',
  'Turbomax',
  'Ule',
  'Ult',
  'Ultima',
  'Ultimate',
  'Ultrasynth',
  'Utto',
  'Vecton',
  'Wipez',
  'Xhd',
  'Xle',
  'Xplore',
  'Xpress',
  'Xtra',
  'Zipp',
  'Blu',
  'Shine',
  'All',
  'Dresser',
  'Smart',
  // Exide ranges (exidecare import, 2026-11-23)
  'Genplus',
  'Gqp',
  'Imtt',
  'Inva',
  'Invamaster',
  'Invatubular',
  'Magic',
  'Nexcharge',
  'Powerbox',
  'Star',
  'Zen',
  // Amaron ranges (amaron import, 2026-11-23)
  'Black',
  'Current',
  'Duro',
  'Flo',
  'Fresh',
  'Harvest',
  'Hiway',
];

/** Vehicle makers and parts brands the product texts name as fitment. */
const MAKERS = ['Ashok', 'Leyland', 'Swaraj', 'Ford', 'Yuasa', 'Dost', 'Tgups'];

/** Standards, grades and acronyms printed in Latin script on the product itself. */
const STANDARDS = [
  'ACEA',
  'CEC',
  'NLGI',
  'ABS',
  'DEXRON',
  'MERCON',
  'IIIH',
  'III',
  'UDT',
  'BSIII',
  'BSIV',
  'Dualock',
  'Titanium',
  'Ultra',
  'Duty',
  'Mini',
  'Cruise',
  'Dresser',
  'Kleaner',
  'API',
  'SAE',
  'DOT',
  'ATF',
  'DEX',
  'MERC',
  'CNG',
  'LPG',
  'SUV',
  'LCV',
  'GDI',
  'JASO',
  'ISI',
  'VRLA',
  'AGM',
  'UPS',
  'OEM',
  'GST',
  'GSTIN',
  'MRP',
  'SKU',
  'ASIC',
  'DOD',
  'DSP',
  'KVA',
  'LCD',
  'LED',
  'MUV',
  'CCA',
  'EFB',
  'SMF',
  'HCV',
];

export const CATALOGUE_PROPER_NAMES: readonly string[] = [...BRANDS, ...SERIES, ...MAKERS, ...STANDARDS];

const PROPER = new Set(CATALOGUE_PROPER_NAMES.map((w) => w.toLowerCase()));

/**
 * Latin words of 3+ letters in `text` that may not appear in Hindi text. Tokens that contain a digit are codes
 * (20W-40, CI-4, MD-RPR-2026) and are skipped, as in the web's `latinOffenders`.
 */
export function hindiLeftovers(text: string): string[] {
  const found = new Set<string>();
  for (const token of text.split(/\s+/)) {
    if (/\d/.test(token)) continue;
    for (const word of token.match(/[A-Za-z]{3,}/g) ?? [])
      if (!PROPER.has(word.toLowerCase())) found.add(word);
  }
  return [...found];
}

/** The proper names in the spellings the catalogue uses (as is, UPPER, Title), for `latinOffenders(text, extra)`. */
export function catalogueProperNameForms(): string[] {
  return CATALOGUE_PROPER_NAMES.flatMap((w) => [
    w,
    w.toUpperCase(),
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
  ]);
}
