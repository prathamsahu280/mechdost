/**
 * Hindi overlays for the DEMO products (part of `./hi.ts`, hard rule 10). Its own module because the shop's client
 * search needs only these: importing `./hi.ts` would ship every workshop, service and area translation with the
 * shop pages (JS budget, spec 16).
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
  'motul-3100-4t-10w30-1l': {
    spec: '2W इंजन ऑयल · 10W30 · 1 L',
    compatibility: '4-स्ट्रोक इंजन और वेट क्लच वाली मोटरसाइकिलें',
    highlights: ['सेमी-सिंथेटिक', 'JASO MA2 · API SM', '1 L पैक'],
  },
  'shell-advance-ax7-10w30-1l': {
    spec: '2W इंजन ऑयल · 10W30 · 1 L',
    compatibility: '4-स्ट्रोक इंजन और वेट क्लच वाली मोटरसाइकिलें',
    highlights: ['सेमी-सिंथेटिक', 'JASO MA2 · API SM', '1 L पैक'],
  },
  'hp-racer4-20w40-900ml': {
    spec: '2W इंजन ऑयल · 20W40 · 900 ml',
    compatibility: '4-स्ट्रोक इंजन वाले सभी दोपहिया वाहन',
    highlights: ['मिनरल ऑयल', 'JASO MA2 · API SL', '900 ml पैक'],
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
    name: 'मिलाज़े X3 पैसेंजर कार टायर',
    spec: 'ट्यूबलेस रेडियल · अपना साइज़ चुनें',
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
  // Heavy vehicles, tractors and machines (design 2026-11-25).
  'mrf-steel-muscle-1000r20-truck-tyre': {
    name: 'स्टील मसल S3L3 10.00 R20',
    spec: '10.00 R20 · 16 PR · ट्यूब टाइप · ट्रक और बस',
    compatibility: '20 इंच रिम वाले ट्रक और बसें',
    highlights: ['मिली-जुली सड़कों के लिए लग पैटर्न', '16 प्लाई रेटिंग', 'दोबारा चढ़ने (रिट्रेड) लायक ढाँचा'],
  },
  'apollo-endurace-lt-700r16-tyre': {
    spec: '7.00 R16 · 14 PR · ट्यूब टाइप · हल्का ट्रक',
    compatibility: '16 इंच रिम वाले पिकअप, टेम्पो और मिनी ट्रक',
    highlights: ['लदे वाहन के लिए मज़बूत साइडवॉल', '14 प्लाई रेटिंग'],
  },
  'ceat-earthmax-175-25-otr-tyre': {
    name: 'अर्थमैक्स 17.5-25 ओटीआर',
    spec: '17.5-25 · 12 PR · लोडर और डोज़र',
    compatibility: '25 इंच रिम वाले व्हील लोडर और ग्रेडर',
    highlights: ['ढीली ज़मीन के लिए गहरी ट्रेड', 'कट-रोधी कंपाउंड'],
  },
  'exide-xpress-hd-180ah-truck-battery': {
    spec: '12 V · 180 Ah · फ़्लडेड · हेवी ड्यूटी',
    compatibility: 'ट्रक, बसें और पिकअप (ऑर्डर से पहले टर्मिनल की तरफ़ जाँच लें)',
    highlights: ['डीज़ल क्रैंकिंग के लिए बनी', 'कंपन सहने वाली', 'पुरानी बैटरी एक्सचेंज ऑफ़र'],
  },
  'amaron-pro-tractor-88ah-battery': {
    name: 'प्रो ट्रैक्टर 12 V 88 Ah',
    spec: '12 V · 88 Ah · फ़्लडेड · ट्रैक्टर',
    compatibility: 'ज़्यादातर 35 से 55 hp ट्रैक्टर',
    highlights: ['ठंड में भी दमदार स्टार्ट', 'धूल और गर्मी में भरोसेमंद'],
  },
  'servo-agri-super-15w40-7l': {
    name: 'एग्री सुपर 15W40 7.5 L',
    spec: 'ट्रैक्टर इंजन ऑयल · 15W40 · 7.5 L',
    compatibility: 'डीज़ल ट्रैक्टर और खेती के इंजन',
    highlights: ['API CH-4 ग्रेड', 'खेत के भारी काम में सुरक्षा', '7.5 L पैक'],
  },
  'exide-inva-master-150ah-inverter-battery': {
    name: 'इन्वा मास्टर 12 V 150 Ah',
    spec: '12 V · 150 Ah · टॉल ट्यूबुलर · घरेलू इन्वर्टर',
    compatibility: 'घर और दुकान के इन्वर्टर (वाहनों के लिए नहीं)',
    highlights: ['लंबा बैकअप', 'कम पानी भरना पड़ता है'],
  },
};
