/**
 * Hindi overlays for the DEMO content data (CLAUDE.md hard rule 10, user 2026-11-02: "its in hindi but i still
 * see quite some stuff in english"). On `/hi` nothing user-visible may be English except brand and model names,
 * units and technical tokens, codes, "MechDost" and user-written text (docs/design-system.md § Hindi content).
 *
 * Kept next to the data it translates, keyed by the same slug/key, so a new product, workshop, service, shop or
 * area without a Hindi entry fails `test/content-i18n.test.ts`. Natural, simple Hindi as Indian shopping apps
 * write it: common English loanwords in Devanagari ("सर्विस", "बैटरी", "इंजन ऑयल"). Business and locality
 * names are transliterated. The real catalogue keeps the same split in `*_hi` columns (docs/decisions.md
 * 2026-11-02 "Localised content columns").
 */

export { PRODUCT_HI, type ProductHi } from './hi-products';

/** Workshop service catalogue, keyed by service key. */
export interface ServiceHi {
  name: string;
  duration: string;
  included: string;
}

export const SERVICE_HI: Readonly<Record<string, ServiceHi>> = {
  diagnosis: {
    name: 'जाँच और डायग्नोसिस',
    duration: '30–60 मिनट',
    included: 'रोड टेस्ट, जहाँ उपलब्ध हो स्कैनर से जाँच, लिखित रिपोर्ट।',
  },
  routine2w: {
    name: 'जनरल सर्विस (2W)',
    duration: '2–3 घंटे',
    included: 'लेबर, चेन एडजस्टमेंट, ब्रेक और टायर जाँच। ऑयल और पार्ट्स का बिल अलग।',
  },
  routine4w: {
    name: 'पीरियॉडिक सर्विस (4W)',
    duration: '3–4 घंटे',
    included: 'लेबर, 25-पॉइंट जाँच, टॉप-अप। ऑयल, फ़िल्टर और पार्ट्स का बिल अलग।',
  },
  oil: {
    name: 'इंजन ऑयल और फ़िल्टर बदलना',
    duration: '30–45 मिनट',
    included: 'सिर्फ़ लेबर; अपना ऑयल लाएँ या MechDost से खरीदें।',
  },
  brakes: {
    name: 'ब्रेक जाँच और सर्विस',
    duration: '45 मिनट',
    included: 'पैड/शू की जाँच, सफ़ाई और एडजस्टमेंट।',
  },
  battery: {
    name: 'बैटरी और स्टार्टिंग जाँच',
    duration: '20–30 मिनट',
    included: 'लोड टेस्ट, टर्मिनल की सफ़ाई, चार्जिंग सिस्टम की जाँच।',
  },
  tyres: {
    name: 'टायर फ़िटिंग और जाँच',
    duration: '20–40 मिनट',
    included: 'फ़िटिंग, हवा के प्रेशर की जाँच, पंक्चर की जाँच।',
  },
  ac: {
    name: 'AC जाँच और सफ़ाई',
    duration: '45–90 मिनट',
    included: 'कूलिंग की जाँच, फ़िल्टर की सफ़ाई; गैस रीफ़िल का दाम अलग से बताया जाएगा।',
  },
  alignment: {
    name: 'व्हील अलाइनमेंट और बैलेंसिंग',
    duration: '45–60 मिनट',
    included: 'कंप्यूटराइज़्ड अलाइनमेंट और चारों पहियों की बैलेंसिंग।',
  },
  ev: {
    name: 'EV बेसिक जाँच',
    duration: '45 मिनट',
    included: 'बैटरी हेल्थ रीडिंग, ब्रेक, टायर और चार्जिंग पोर्ट की जाँच।',
  },
  wash: {
    name: 'धुलाई और अंदर की सफ़ाई',
    duration: '1–2 घंटे',
    included: 'फ़ोम वॉश, वैक्यूम, डैशबोर्ड पॉलिश।',
  },
};

/** Workshop business name and street address (transliterated); the area comes from `AREA_HI`. */
export interface WorkshopHi {
  name: string;
  address: string;
}

export const WORKSHOP_HI: Readonly<Record<string, WorkshopHi>> = {
  'pachpedi-naka-two-wheeler-care': {
    name: 'पचपेड़ी नाका टू-व्हीलर केयर',
    address: 'पचपेड़ी नाका चौक के पास, रायपुर',
  },
  'telibandha-car-clinic': { name: 'तेलीबांधा कार क्लिनिक', address: 'जी.ई. रोड, तेलीबांधा, रायपुर' },
  'shankar-nagar-auto-hub': { name: 'शंकर नगर ऑटो हब', address: 'मेन रोड, शंकर नगर, रायपुर' },
  'devendra-nagar-motors': {
    name: 'देवेंद्र नगर मोटर्स सर्विस',
    address: 'सेक्टर 2, देवेंद्र नगर, रायपुर',
  },
  'tatibandh-multi-brand-garage': {
    name: 'टाटीबंध मल्टी-ब्रांड गैराज',
    address: 'टाटीबंध चौक के पास, रायपुर',
  },
  'mowa-ev-and-bike-point': { name: 'मोवा EV और बाइक पॉइंट', address: 'मोवा मेन रोड, रायपुर' },
  'amapara-express-service': { name: 'आमापारा एक्सप्रेस सर्विस', address: 'आमापारा चौक, रायपुर' },
  'sarona-car-care': { name: 'सरोना कार केयर', address: 'सरोना, सालासर ग्रीन्स के पास, रायपुर' },
};

/** Partner shop business names (transliterated). */
export const SHOP_HI: Readonly<Record<string, string>> = {
  'sharma-auto-parts': 'शर्मा ऑटो पार्ट्स',
  'chhattisgarh-tyre-house': 'छत्तीसगढ़ टायर हाउस',
  'raipur-battery-point': 'रायपुर बैटरी पॉइंट',
  'gupta-lubes-spares': 'गुप्ता ल्यूब्स एंड स्पेयर्स',
};

/** Raipur localities (workshops, shops, reviewers). Keyed by the English name stored in the data. */
export const AREA_HI: Readonly<Record<string, string>> = {
  'Pachpedi Naka': 'पचपेड़ी नाका',
  Telibandha: 'तेलीबांधा',
  'Shankar Nagar': 'शंकर नगर',
  'Devendra Nagar': 'देवेंद्र नगर',
  Tatibandh: 'टाटीबंध',
  Mowa: 'मोवा',
  Amapara: 'आमापारा',
  Sarona: 'सरोना',
  Pandri: 'पंडरी',
  Raipur: 'रायपुर',
};

/** Opening-hours day names ("9:00 – 20:00 · Mon–Sat"). */
export const DAY_HI: Readonly<Record<string, string>> = {
  Mon: 'सोम',
  Tue: 'मंगल',
  Wed: 'बुध',
  Thu: 'गुरु',
  Fri: 'शुक्र',
  Sat: 'शनि',
  Sun: 'रवि',
};
