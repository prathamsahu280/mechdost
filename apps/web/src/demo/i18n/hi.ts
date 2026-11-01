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

/** Descriptive product fields. Brand and model stay in Latin script; `name` is set only where it has words. */
export interface ProductHi {
  name?: string;
  spec: string;
  compatibility: string;
  highlights: readonly string[];
}

export const PRODUCT_HI: Readonly<Record<string, ProductHi>> = {
  'castrol-activ-4t-20w40-900ml': {
    spec: '2W इंजन ऑयल · 20W40 · 900 ml',
    compatibility: '4-स्ट्रोक इंजन वाले सभी दोपहिया वाहन',
    highlights: ['इंजन की सुरक्षा के लिए ऐक्टिबॉन्ड मॉलिक्यूल', 'JASO MA2 · API SL', '900 ml पैक'],
  },
  'exide-xltz4a-2w-battery': {
    spec: '12 V · 3 Ah · VRLA · फ़ैक्टरी चार्ज्ड',
    compatibility: 'ज़्यादातर 100–125 cc मोटरसाइकिल और स्कूटर',
    highlights: ['मेंटेनेंस-फ़्री', '24F + 24P वारंटी', 'भेजने से पहले फ़िटमेंट जाँच'],
  },
  'scooter-tubeless-tyre-90-90-12': {
    name: 'ट्यूबलेस स्कूटर टायर 90/90-12',
    spec: '90/90-12 · 54J · ट्यूबलेस',
    compatibility: 'Activa, Jupiter, Access आगे/पीछे (साइज़ जाँच लें)',
    highlights: ['गीली सड़क पर बेहतर पकड़', 'पार्टनर वर्कशॉप पर फ़िटिंग उपलब्ध'],
  },
  'car-tyre-185-65-r15': {
    name: 'पैसेंजर कार टायर 185/65 R15',
    spec: '185/65 R15 · 88H · ट्यूबलेस',
    compatibility: 'Dzire, Amaze, Xcent और इन जैसी कारें (साइज़ जाँच लें)',
    highlights: ['चलते समय कम आवाज़', 'माँगने पर अलाइनमेंट और बैलेंसिंग'],
  },
  'car-starter-battery-45ah': {
    name: 'कार स्टार्टर बैटरी 45 Ah',
    spec: '12 V · 45 Ah · मेंटेनेंस-फ़्री',
    compatibility: 'हैचबैक और कॉम्पैक्ट सेडान (टर्मिनल की दिशा जाँच लें)',
    highlights: ['माँगने पर पुरानी बैटरी पर एक्सचेंज छूट', 'इंस्टॉलेशन उपलब्ध'],
  },
  'heavy-duty-battery-90ah': {
    name: 'हेवी-ड्यूटी वाहन बैटरी 90 Ah',
    spec: '12 V · 90 Ah',
    compatibility: 'SUV, पिक-अप और हल्के कमर्शियल वाहन',
    highlights: ['सप्लायर से पुष्टि ज़रूरी', 'डिलीवरी के साथ इंस्टॉलेशन'],
  },
  'synthetic-engine-oil-5w30-3-5l': {
    name: 'फ़ुली सिंथेटिक इंजन ऑयल 5W-30 3.5 L',
    spec: '5W-30 · API SP · 3.5 L',
    compatibility: 'पेट्रोल कारें; ओनर मैनुअल में ग्रेड देख लें',
    highlights: ['बेहतर माइलेज वाला ग्रेड', 'ऑयल फ़िल्टर के साथ लें'],
  },
  'engine-oil-filter-petrol-car': {
    name: 'इंजन ऑयल फ़िल्टर',
    spec: 'स्पिन-ऑन · पेट्रोल कारें',
    compatibility: 'Maruti Suzuki पेट्रोल मॉडल (OEM नंबर जाँच लें)',
    highlights: ['OEM जैसी फ़िल्ट्रेशन', 'हर ऑयल चेंज पर बदलें'],
  },
  'diesel-fuel-filter': {
    name: 'डीज़ल फ़्यूल फ़िल्टर',
    spec: 'इनलाइन · डीज़ल',
    compatibility: 'कॉमन-रेल डीज़ल SUV (OEM नंबर जाँच लें)',
    highlights: ['पानी अलग करता है', 'इंजेक्टर को सुरक्षित रखता है'],
  },
  'front-wheel-bearing-kit': {
    name: 'फ़्रंट व्हील बेयरिंग किट',
    spec: 'डबल-रो एंगुलर कॉन्टैक्ट · सील के साथ',
    compatibility: 'कॉम्पैक्ट कारें (पार्ट रेफ़रेंस जाँच लें)',
    highlights: ['सप्लायर से पुष्टि ज़रूरी', 'वर्कशॉप से फ़िटिंग करवाने की सलाह'],
  },
  'motorcycle-wheel-bearing-6301': {
    name: 'व्हील बेयरिंग 6301-2RS',
    spec: '12 × 37 × 12 mm · सील्ड',
    compatibility: 'कई 100–150 cc मोटरसाइकिलें',
    highlights: ['2 का सेट', 'दोनों तरफ़ से सील्ड'],
  },
  'brake-pad-set-front': {
    name: 'फ़्रंट ब्रेक पैड सेट',
    spec: 'सिरेमिक · आगे का एक्सल',
    compatibility: 'Hyundai i20 / Venue (पार्ट रेफ़रेंस जाँच लें)',
    highlights: ['कम धूल', 'पार्टनर वर्कशॉप पर फ़िटिंग'],
  },
  'chain-sprocket-kit-150cc': {
    name: 'चेन स्प्रॉकेट किट',
    spec: '428 चेन · 14T / 42T',
    compatibility: '150 cc मोटरसाइकिलें (दाँतों की गिनती जाँच लें)',
    highlights: ['O-रिंग चेन', 'आगे और पीछे के स्प्रॉकेट शामिल'],
  },
  'spark-plug-iridium': {
    name: 'इरिडियम स्पार्क प्लग',
    spec: 'CPR8EAIX-9 · इरिडियम',
    compatibility: 'कई 125–200 cc मोटरसाइकिलें',
    highlights: ['जल्दी स्टार्ट', 'कॉपर प्लग से ज़्यादा लंबी उम्र'],
  },
  'all-weather-car-floor-mats': {
    name: 'ऑल-वेदर कार फ़्लोर मैट सेट',
    spec: '5 पीस · TPE · उठे हुए किनारे',
    compatibility: 'हैचबैक और सेडान में यूनिवर्सल फ़िट',
    highlights: ['धोकर दोबारा इस्तेमाल करें', 'फिसलन-रोधी बैकिंग'],
  },
  'two-wheeler-body-cover': {
    name: 'दोपहिया प्रोटेक्टिव कवर',
    spec: 'पानी से बचाव · UV से सुरक्षा',
    compatibility: '150 cc तक के स्कूटर और मोटरसाइकिल',
    highlights: ['इलास्टिक किनारा', 'रखने के लिए पाउच'],
  },
  'socket-tool-set-46pc': {
    name: 'वर्कशॉप सॉकेट टूल सेट 46 पीस',
    spec: '1/4" ड्राइव · 4–14 mm · रैचेट',
    compatibility: 'घर और वर्कशॉप के लिए',
    highlights: ['क्रोम वैनेडियम', 'कैरी केस'],
  },
  'digital-tyre-pressure-gauge': {
    name: 'डिजिटल टायर प्रेशर गेज',
    spec: '0–100 psi · बैकलिट डिस्प्ले',
    compatibility: 'कार और दोपहिया',
    highlights: ['±1 psi तक सटीक', 'अपने-आप बंद'],
  },
  'ev-12v-auxiliary-battery': {
    name: 'EV ऑक्ज़िलरी बैटरी 12 V',
    spec: '12 V · 35 Ah · AGM',
    compatibility: 'इलेक्ट्रिक कारें (ऑर्डर से पहले मॉडल जाँच लें)',
    highlights: ['इलेक्ट्रिकल मेल हमारी टीम जाँचती है', 'इंस्टॉलेशन की सलाह'],
  },
  'ev-portable-charger-15a': {
    name: 'पोर्टेबल EV चार्जिंग केबल 15 A',
    spec: 'टाइप 2 · 15 A · 5 m',
    compatibility: 'टाइप 2 इनलेट वाली EV कारें',
    highlights: ['अर्थ-लीकेज से सुरक्षा', 'दीवार के सॉकेट की रेटिंग जाँच लें'],
  },
};

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
