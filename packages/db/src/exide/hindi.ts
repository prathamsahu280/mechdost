/**
 * Hindi for the Exide import (hard rule 10): what the maker prints as marketing lines, the fuel and start words of the
 * fitment list and the labels of the spec table. Brand, range and model names stay in Latin script
 * (`packages/shared/src/catalogue-hindi.ts`); everything else here is Devanagari. A feature line without an entry
 * here is left out of the Hindi text and listed by the planner (`untranslated`), never copied in English.
 */

/** The maker's marketing feature lines (44 on the 211 rows), exactly as `exide_batteries.csv` writes them. */
export const FEATURES_HI: Readonly<Record<string, string>> = {
  'High cranking power': 'उच्च क्रैंकिंग शक्ति',
  'Low self discharge': 'कम सेल्फ़-डिस्चार्ज',
  'Robust design to take care of stringent application requirements':
    'कठिन उपयोग की ज़रूरतों के लिए मज़बूत डिज़ाइन',
  'Microcontroller Based Pure Sine Wave Home UPS System':
    'माइक्रोकंट्रोलर आधारित प्योर साइन वेव होम UPS सिस्टम',
  'Optimized Alloy System to suit high temperature': 'ऊँचे तापमान के अनुकूल बेहतर अलॉय सिस्टम',
  'Indias No. 1 truck Battery': 'भारत की नंबर 1 ट्रक बैटरी',
  'Original VRLA battery to Rule the road': 'सड़क पर राज करने वाली मूल VRLA बैटरी',
  'Microcontroller Based Digital Wave Home UPS System': 'माइक्रोकंट्रोलर आधारित डिजिटल वेव होम UPS सिस्टम',
  'Long Life Tubular Battery': 'लंबी उम्र वाली ट्यूबुलर बैटरी',
  'Low Maintenance Tubular': 'कम रखरखाव वाली ट्यूबुलर बैटरी',
  'DSP Based Pure Sine Wave HKVA UPS Systems': 'DSP आधारित प्योर साइन वेव HKVA UPS सिस्टम',
  'Tubular Inverter Battery': 'ट्यूबुलर इन्वर्टर बैटरी',
  'Advanced tubular,Low Maintenance': 'उन्नत ट्यूबुलर, कम रखरखाव',
  'Excellent spill resistance characteristics': 'बेहतरीन स्पिल-रोधी गुण',
  'Perfect partner for three-wheelers and LCV': 'तिपहिया वाहनों और LCV के लिए सटीक साथी',
  'Indias No. 1 Tractor Battery': 'भारत की नंबर 1 ट्रैक्टर बैटरी',
  'The Ultimate Inverter Battery': 'सर्वश्रेष्ठ इन्वर्टर बैटरी',
  'DSP Based Pure Sine Wave Home UPS Systems': 'DSP आधारित प्योर साइन वेव होम UPS सिस्टम',
  'Future-Ready Battery': 'भविष्य के लिए तैयार बैटरी',
  "India's First SUV Ready Battery": 'भारत की पहली SUV रेडी बैटरी',
  'Advance Tubular, High Performance': 'उन्नत ट्यूबुलर, उच्च प्रदर्शन',
  'PENTA ALLOY which enhances corrosion resistance in service':
    'पेंटा अलॉय, जो उपयोग में जंग से बचाव बढ़ाता है',
  'Technology for tomorrow': 'आने वाले कल की तकनीक',
  'Batteries tailor-made for gensets': 'जेनसेट के लिए खास तौर पर बनी बैटरियाँ',
  'High on efficiency': 'उच्च दक्षता',
  'Higher mileage, long life, low maintenance, more powerful, high charge acceptance':
    'ज़्यादा माइलेज, लंबी उम्र, कम रखरखाव, ज़्यादा ताकत, तेज़ चार्ज स्वीकार',
  'Zero Maintenance Sealed': 'ज़ीरो मेंटेनेंस सीलबंद बैटरी',
  'Tubular Plate Design': 'ट्यूबुलर प्लेट डिज़ाइन',
  'Standard Range for Normal Usage': 'सामान्य उपयोग के लिए स्टैंडर्ड रेंज',
  'Suitable for Deep Discharge': 'डीप डिस्चार्ज के लिए उपयुक्त',
  '1000 Cycles @ 80% DOD': '80% DOD पर 1000 साइकिल',
  'Wide Range Mains Input Voltage for Battery Charging 90V - 300V AC':
    'बैटरी चार्जिंग के लिए चौड़ा मेन्स इनपुट वोल्टेज 90V - 300V AC',
  'LED Display for User Interface': 'यूज़र इंटरफ़ेस के लिए LED डिस्प्ले',
  'Lithium Ferro Phosphate Inverter Battery': 'लिथियम फेरो फॉस्फेट इन्वर्टर बैटरी',
  'Thermal Circuit Breaker for Mains Overload Protection': 'मेन्स ओवरलोड सुरक्षा के लिए थर्मल सर्किट ब्रेकर',
  'Dual Stage of Charging': 'दो चरणों में चार्जिंग',
  'Ultimate Inverter Battery': 'सर्वश्रेष्ठ इन्वर्टर बैटरी',
  'Thicker Plates - Ideal for tough usage conditions': 'मोटी प्लेटें, कठिन उपयोग के लिए आदर्श',
  'More Electrolyte Per Ampere Hour': 'प्रति एम्पियर-घंटा ज़्यादा इलेक्ट्रोलाइट',
  '1200 Cycles @ 80% DOD': '80% DOD पर 1200 साइकिल',
  '3 Stage Intelligent ASIC Charging': '3 चरणों वाली इंटेलिजेंट ASIC चार्जिंग',
  'LCD and LED Dual Display': 'LCD और LED दोहरा डिस्प्ले',
  'Manual Mains Bypass Facility': 'मैनुअल मेन्स बाईपास सुविधा',
  '16 Amps Output Socket': '16 एम्पियर आउटपुट सॉकेट',
};

/** Generic words of a range name ("Exide Home New Star") that have a Hindi word; the rest are the maker's own names. */
export const RANGE_WORDS_HI: Readonly<Record<string, string>> = {
  inverter: 'इन्वर्टर',
  home: 'होम',
  new: 'न्यू',
  battery: 'बैटरी',
  combo: 'कॉम्बो',
  tubular: 'ट्यूबुलर',
};

/** Labels of the extra spec table rows worth showing in Hindi (all other rows stay in `spec.otherSpecs` only). */
export const SPEC_LABELS_HI: Readonly<Record<string, string>> = {
  'output voltage at no load': 'बिना लोड आउटपुट वोल्टेज',
  'output frequency': 'आउटपुट फ़्रीक्वेंसी',
  'wattage rating': 'वाट रेटिंग',
  efficiency: 'दक्षता',
  'nominal battery voltage': 'बैटरी वोल्टेज',
  'battery low cut off': 'बैटरी लो कट-ऑफ',
  'battery boost voltage': 'बैटरी बूस्ट वोल्टेज',
  'battery float voltage': 'बैटरी फ़्लोट वोल्टेज',
  'battery type': 'बैटरी का प्रकार',
  voltage: 'वोल्टेज',
  'va rating': 'VA रेटिंग',
  'max wattage': 'अधिकतम वाट',
  'wave form': 'वेव फ़ॉर्म',
  transformer: 'ट्रांसफ़ॉर्मर',
  controller: 'कंट्रोलर',
  type: 'प्रकार',
};

/** Values of those rows that are words, not numbers. */
export const SPEC_VALUES_HI: Readonly<Record<string, string>> = {
  'pure sine wave': 'प्योर साइन वेव',
  '100% pure copper transformer': '100% शुद्ध कॉपर ट्रांसफ़ॉर्मर',
  'dsp technology': 'DSP तकनीक',
  'tall tubular': 'टॉल ट्यूबुलर',
  'flat plate': 'फ़्लैट प्लेट',
};

export { FUEL_EN, FUEL_HI, fuelCode, TERMINAL_EN, TERMINAL_HI } from '../battery-import/hindi';
