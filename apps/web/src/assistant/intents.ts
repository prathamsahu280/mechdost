/**
 * Static intent matching for the assistant (docs/specs/18-assistant.md). Deliberately simple: keyword groups in
 * English, Hindi and Hinglish. When the LLM backend is connected this stays as the offline fallback.
 */
export const INTENTS = ['bulk', 'track', 'partner', 'workshop', 'shop', 'contact'] as const;
export type Intent = (typeof INTENTS)[number] | 'fallback';
type KnownIntent = (typeof INTENTS)[number];

const KEYWORDS: Record<KnownIntent, string[]> = {
  bulk: ['bulk', 'wholesale', 'quantity', 'quote', 'quotation', 'dozen', 'fleet', 'बल्क', 'थोक', 'कोटेशन'],
  track: [
    'track',
    'order status',
    'where is my',
    'my order',
    'delivery status',
    'refund',
    'cancel',
    'ट्रैक',
    'ऑर्डर कहाँ',
    'रिफ़ंड',
    'कैंसल',
  ],
  partner: ['partner', 'seller', 'sell', 'register my', 'join', 'vendor', 'पार्टनर', 'सेलर', 'बेचना', 'जुड़'],
  workshop: [
    'workshop',
    'service',
    'repair',
    'garage',
    'mechanic',
    'estimate',
    'appointment',
    'book',
    'वर्कशॉप',
    'सर्विस',
    'मरम्मत',
    'रिपेयर',
    'गैराज',
    'मैकेनिक',
  ],
  shop: [
    'buy',
    'product',
    'price',
    'tyre',
    'tire',
    'battery',
    'oil',
    'filter',
    'part',
    'brake',
    'shop',
    'ख़रीद',
    'खरीद',
    'प्रोडक्ट',
    'टायर',
    'बैटरी',
    'ऑयल',
    'दाम',
  ],
  contact: [
    'contact',
    'call',
    'phone',
    'whatsapp',
    'talk',
    'human',
    'support',
    'help',
    'संपर्क',
    'कॉल',
    'बात',
  ],
};

const ASCII = /^[a-z ]+$/;
const WORD_CHAR = /[a-z0-9]/;

/** Latin keywords match at a word start ("part" must not match "partner"); Devanagari matches anywhere. */
function matches(text: string, keyword: string): boolean {
  if (!ASCII.test(keyword)) return text.includes(keyword);
  let from = text.indexOf(keyword);
  while (from !== -1) {
    if (from === 0 || !WORD_CHAR.test(text.charAt(from - 1))) return true;
    from = text.indexOf(keyword, from + 1);
  }
  return false;
}

/**
 * First matching intent in priority order: bulk before shop ("bulk battery price" is a quote request) and
 * partner before shop ("sell spare parts" is a partner enquiry).
 */
export function detectIntent(message: string): Intent {
  const text = message.toLowerCase().normalize('NFC');
  for (const intent of INTENTS) {
    if (KEYWORDS[intent].some((k) => matches(text, k))) return intent;
  }
  return 'fallback';
}
