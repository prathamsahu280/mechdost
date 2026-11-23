/**
 * Hindi for the Amaron import (hard rule 10). Brand, range and model names stay in Latin script
 * (`packages/shared/src/catalogue-hindi.ts`); everything else is Devanagari. A feature line without an entry here is
 * left out of the Hindi text and listed by the planner (`untranslated`), never copied in English. The keys are the
 * lines exactly as `amaron_batteries.csv` writes them after `cleanSpecText` removes the broken `�` bytes (they stood
 * for the trade mark sign); the English side is the tidied wording shown on the site.
 */
export const FEATURES: Readonly<Record<string, { en: string; hi: string }>> = {
  'High Cranking Power': { en: 'High cranking power', hi: 'उच्च क्रैंकिंग शक्ति' },
  'Zero-Maintenance': { en: 'Zero maintenance', hi: 'ज़ीरो मेंटेनेंस' },
  'Improved Safety': { en: 'Improved safety', hi: 'बेहतर सुरक्षा' },
  'Long Life': { en: 'Long life', hi: 'लंबी उम्र' },
  'Vibration Resistance': { en: 'Vibration resistance', hi: 'झटकों और कंपन से सुरक्षा' },
  'High Reserve Capacity': { en: 'High reserve capacity', hi: 'ऊँची रिज़र्व क्षमता' },
  'Heat Tolerance': { en: 'Heat tolerance', hi: 'गर्मी सहने की क्षमता' },
  'HI-COERCE high pressure spine casting (>100bar) for superior life': {
    en: 'HI-COERCE high-pressure spine casting (over 100 bar) for a longer life',
    hi: 'हाई-कोअर्स हाई-प्रेशर स्पाइन कास्टिंग (100 बार से ज़्यादा), बेहतर उम्र के लिए',
  },
  'PANOPTIC SPINE (For reduced corrosion leading to last long': {
    en: 'PANOPTIC SPINE for less corrosion and a long life',
    hi: 'पैनॉप्टिक स्पाइन, कम जंग और लंबी उम्र के लिए',
  },
  'Ultra low maintenance': { en: 'Ultra low maintenance', hi: 'बहुत कम रखरखाव' },
  'SATIATED WET PASTE (Gives higher active material integrity, lowers resistance to deliver consistent power & life)':
    {
      en: 'SATIATED WET PASTE gives higher active-material integrity and lower resistance for steady power and life',
      hi: 'सैटिएटेड वेट पेस्ट, सक्रिय पदार्थ की मज़बूती बढ़ाता है और प्रतिरोध घटाता है, ताकि बिजली और उम्र स्थिर रहे',
    },
  'SERRATED SEP (Reduced stratification and float currents provides better performance)': {
    en: 'SERRATED SEP reduces stratification and float currents for better performance',
    hi: 'सेरेटेड सेप, स्ट्रैटिफ़िकेशन और फ़्लोट करंट घटाकर बेहतर प्रदर्शन देता है',
  },
  'Zero-Volt Pick-Up: Revives deeply discharged batteries without an external charger.': {
    en: 'Zero-volt pick-up: revives deeply discharged batteries without an external charger',
    hi: 'ज़ीरो-वोल्ट पिक-अप: पूरी तरह उतरी बैटरी को बाहरी चार्जर के बिना फिर चालू करता है',
  },
  'Wide Charging Range: Ideal for all locations with fast charging capability.': {
    en: 'Wide charging range: fast charging, ideal for all locations',
    hi: 'चौड़ी चार्जिंग रेंज: तेज़ चार्जिंग, हर जगह के लिए उपयुक्त',
  },
  'Advanced Protection: Safeguards the unit during power fluctuations.': {
    en: 'Advanced protection: safeguards the unit during power fluctuations',
    hi: 'उन्नत सुरक्षा: बिजली के उतार-चढ़ाव में यूनिट की रक्षा करता है',
  },
  'Extensive Battery Compatibility: Auto-adjusts charging for flat plate, SMF and tubular batteries.': {
    en: 'Extensive battery compatibility: adjusts charging by itself for flat plate, SMF and tubular batteries',
    hi: 'व्यापक बैटरी संगतता: फ़्लैट प्लेट, SMF और ट्यूबुलर बैटरियों के लिए चार्जिंग अपने-आप ठीक करता है',
  },
  'Pure Sine Wave output suitable for electrical and electronics loads.': {
    en: 'Pure sine wave output, suitable for electrical and electronic loads',
    hi: 'प्योर साइन वेव आउटपुट, बिजली और इलेक्ट्रॉनिक उपकरणों के लिए उपयुक्त',
  },
  'More back-up time achieved with smart design transformer.': {
    en: 'More back-up time with a smart-design transformer',
    hi: 'स्मार्ट डिज़ाइन ट्रांसफ़ॉर्मर से ज़्यादा बैकअप समय',
  },
  'i-DSP based automatic battery charge level management provides power saving with efficient battery charging.':
    {
      en: 'i-DSP based automatic battery charge-level management saves power with efficient charging',
      hi: 'i-DSP आधारित ऑटोमैटिक बैटरी चार्ज-लेवल प्रबंधन, कुशल चार्जिंग से बिजली की बचत',
    },
  'Quick/Normal Charge mode suits for places where less power cuts and frequent power cuts occur.': {
    en: 'Quick and normal charge modes, for places with few or frequent power cuts',
    hi: 'क्विक और नॉर्मल चार्ज मोड, कम या बार-बार बिजली कटने वाली जगहों के लिए',
  },
};

/** Generic words of an Amaron name or range that have a Hindi word; the rest are the maker's own names or codes. */
export const NAME_WORDS_HI: Readonly<Record<string, string>> = {
  'high-capacity': 'हाई-कैपेसिटी',
  inverters: 'इन्वर्टर',
  inverter: 'इन्वर्टर',
  sine: 'साइन',
  wave: 'वेव',
  square: 'स्क्वायर',
  home: 'होम',
  tall: 'टॉल',
  short: 'शॉर्ट',
  tubular: 'ट्यूबुलर',
  bike: 'बाइक',
  rider: 'राइडर',
};

export const TECHNOLOGY_HI: Readonly<Record<string, string>> = {
  'tubular - flooded': 'ट्यूबुलर - फ़्लडेड',
};

export const FORM_FACTOR_HI: Readonly<Record<string, string>> = {
  'tall tubular': 'टॉल ट्यूबुलर',
  'short tubular': 'शॉर्ट ट्यूबुलर',
};

/** The three views of a product picture, in gallery order (Front, Side, Top; a "View" picture takes the side slot). */
export const VIEWS: Readonly<Record<string, { rank: number; code: string; en: string; hi: string }>> = {
  front: { rank: 0, code: 'front', en: 'front view', hi: 'सामने से' },
  side: { rank: 1, code: 'side', en: 'side view', hi: 'बग़ल से' },
  view: { rank: 1, code: 'view', en: 'view', hi: 'दृश्य' },
  top: { rank: 2, code: 'top', en: 'top view', hi: 'ऊपर से' },
};
