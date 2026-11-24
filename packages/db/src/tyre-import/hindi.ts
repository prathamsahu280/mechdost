/**
 * Hindi for the CEAT and MRF tyre imports (hard rule 10). Brand, pattern, size and vehicle names stay in Latin script
 * (`packages/shared/src/catalogue-hindi.ts` lists the pattern names); the generic words are Devanagari.
 */

/** Generic words of a tube or flap product name (letter runs, lower case). */
export const TUBE_WORDS_HI: Readonly<Record<string, string>> = {
  tube: 'ट्यूब',
  tubes: 'ट्यूब',
  flap: 'फ़्लैप',
  flaps: 'फ़्लैप',
  poly: 'पॉली',
  pouch: 'पाउच',
  bias: 'बायस',
  radial: 'रेडियल',
  fitted: 'फिटेड',
  loose: 'लूज़',
  brass: 'ब्रास',
  reinforced: 'रीइन्फोर्स्ड',
  nylon: 'नायलॉन',
  moped: 'मोपेड',
  motorcycle: 'मोटरसाइकिल',
  scooter: 'स्कूटर',
  tractor: 'ट्रैक्टर',
  front: 'फ्रंट',
  rear: 'रियर',
  fork: 'फ़ोर्क',
  lift: 'लिफ़्ट',
  regular: 'रेगुलर',
  butyl: 'ब्यूटाइल',
  with: 'के साथ',
  single: 'सिंगल',
  triple: 'ट्रिपल',
  bent: 'बेंट',
  valve: 'वाल्व',
};

/** Generic words at the end of a tyre name ("(tube included)", "Solid Tyre", "Front") and in pattern suffixes. */
export const TYRE_WORDS_HI: Readonly<Record<string, string>> = {
  tube: 'ट्यूब',
  included: 'सहित',
  with: 'के साथ',
  without: 'के बिना',
  foam: 'फ़ोम',
  solid: 'सॉलिड',
  tyre: 'टायर',
  front: 'फ्रंट',
  rear: 'रियर',
  scooter: 'स्कूटर',
  ply: 'प्लाई',
};

/** The Hindi form of a name: its letter runs found in `words` are translated, everything else stays as written. */
export function hindiName(name: string, words: Readonly<Record<string, string>>): string {
  return name.replace(/[A-Za-z]+/g, (run) => {
    const hit = words[run.toLowerCase()];
    return hit ?? run;
  });
}

export const CONSTRUCTION_EN: Readonly<Record<string, string>> = { radial: 'Radial', bias: 'Bias' };
export const CONSTRUCTION_HI: Readonly<Record<string, string>> = { radial: 'रेडियल', bias: 'बायस' };

export const POSITION_EN: Readonly<Record<string, string>> = {
  front: 'Front',
  rear: 'Rear',
  both: 'Front or rear',
};
export const POSITION_HI: Readonly<Record<string, string>> = {
  front: 'आगे का',
  rear: 'पीछे का',
  both: 'आगे या पीछे',
};

export const FITMENT_OPTION_HI: Readonly<Record<string, string>> = {
  recommended: 'सुझाया गया',
  other: 'दूसरा विकल्प',
  upsize: 'अपसाइज़',
};
