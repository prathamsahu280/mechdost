/**
 * Plain-language phrases that fill email placeholders (hard rule 10: Hindi is written, not word-for-word). The
 * repositories pick the phrase in the recipient's language when they queue the email, so the outbox payload holds
 * ready text and the template stays a closed list of placeholders. Codes in, words out; unknown codes fall back
 * to the neutral "other" wording, never to the raw code.
 */
import type { ORDER_CANCEL_REASONS, ORDER_REJECT_REASONS } from './state/index';
import { formatINR } from './money';
import { IST_TIMEZONE } from './time';

export type PhraseLocale = 'en' | 'hi';
type Pair = Readonly<Record<PhraseLocale, string>>;

const CANCEL_REASON = {
  changed_mind: {
    en: 'The order was cancelled because you changed your mind.',
    hi: 'आपने अपना मन बदल लिया, इसलिए ऑर्डर रद्द किया गया।',
  },
  ordered_by_mistake: {
    en: 'The order was cancelled because it was placed by mistake.',
    hi: 'ऑर्डर गलती से हो गया था, इसलिए रद्द किया गया।',
  },
  found_cheaper: {
    en: 'The order was cancelled because you found a better price elsewhere.',
    hi: 'आपको कहीं और बेहतर दाम मिला, इसलिए ऑर्डर रद्द किया गया।',
  },
  delivery_too_slow: {
    en: 'The order was cancelled because delivery would take too long.',
    hi: 'डिलीवरी में ज़्यादा समय लगता, इसलिए ऑर्डर रद्द किया गया।',
  },
  customer_unreachable: {
    en: 'The order was cancelled because we could not reach you.',
    hi: 'हम आपसे संपर्क नहीं कर पाए, इसलिए ऑर्डर रद्द किया गया।',
  },
  payment_not_completed: {
    en: 'The order was cancelled because the payment was not completed in time.',
    hi: 'समय पर पेमेंट पूरा नहीं हुआ, इसलिए ऑर्डर रद्द किया गया।',
  },
  other: { en: 'The order was cancelled.', hi: 'ऑर्डर रद्द कर दिया गया है।' },
} satisfies Readonly<Record<(typeof ORDER_CANCEL_REASONS)[number], Pair>>;

const REJECT_REASON = {
  no_stock_nearby: {
    en: 'We could not find a seller with this item in stock near you.',
    hi: 'आपके पास किसी विक्रेता के पास यह सामान स्टॉक में नहीं मिला।',
  },
  all_shops_declined: {
    en: 'The sellers near you were not able to fulfil this order.',
    hi: 'आपके पास के विक्रेता यह ऑर्डर पूरा नहीं कर पाए।',
  },
  unserviceable_address: {
    en: 'We cannot deliver to this address yet.',
    hi: 'हम अभी इस पते पर डिलीवरी नहीं कर पाते।',
  },
  suspected_fraud: { en: 'We could not verify this order.', hi: 'हम इस ऑर्डर की पुष्टि नहीं कर पाए।' },
  pricing_error: {
    en: 'The price shown for this item was wrong, so we could not accept the order.',
    hi: 'इस सामान का दाम गलत दिखा था, इसलिए हम ऑर्डर स्वीकार नहीं कर पाए।',
  },
  other: { en: 'We could not fulfil this order.', hi: 'हम यह ऑर्डर पूरा नहीं कर पाए।' },
} satisfies Readonly<Record<(typeof ORDER_REJECT_REASONS)[number], Pair>>;

const WARNING_REASON: Readonly<Record<string, Pair>> = {
  missed_offers: {
    en: 'several order requests were not answered in time',
    hi: 'कई ऑर्डर अनुरोधों का समय पर जवाब नहीं मिला',
  },
  gave_up_orders: {
    en: 'orders were given back after you had accepted them',
    hi: 'स्वीकार करने के बाद कुछ ऑर्डर वापस कर दिए गए',
  },
  late_deliveries: { en: 'some deliveries were late', hi: 'कुछ डिलीवरी देर से हुईं' },
  quality_complaints: {
    en: 'customers raised quality concerns',
    hi: 'ग्राहकों ने गुणवत्ता को लेकर शिकायतें की हैं',
  },
  pricing_issue: { en: 'there was a problem with the prices listed', hi: 'दर्ज किए गए दामों में समस्या थी' },
  policy_violation: {
    en: 'a MechDost partner policy was not followed',
    hi: 'MechDost की पार्टनर नीति का पालन नहीं हुआ',
  },
  other: {
    en: 'MechDost has a note about your recent activity',
    hi: 'आपकी हाल की गतिविधि को लेकर MechDost का एक नोट है',
  },
};

const APPLICATION_REASON: Readonly<Record<string, Pair>> = {
  not_serviceable: { en: 'We do not serve your area yet.', hi: 'हम अभी आपके इलाके में सेवा नहीं देते।' },
  documents_invalid: {
    en: 'We could not verify the details you gave.',
    hi: 'आपके दिए विवरण की पुष्टि नहीं हो पाई।',
  },
  duplicate: {
    en: 'We already have an application for this business.',
    hi: 'इस कारोबार का आवेदन हमारे पास पहले से है।',
  },
  not_a_business: {
    en: 'We could not confirm that this is a registered business.',
    hi: 'हम पुष्टि नहीं कर पाए कि यह पंजीकृत कारोबार है।',
  },
  other: {
    en: 'We are not able to take this application forward right now.',
    hi: 'हम अभी इस आवेदन को आगे नहीं बढ़ा पा रहे हैं।',
  },
};

const SERVICE_CANCEL_REASON: Readonly<Record<string, Pair>> = {
  workshop_unavailable: {
    en: 'The workshop could not take your booking.',
    hi: 'वर्कशॉप आपकी बुकिंग नहीं ले पाई।',
  },
  workshop_unresponsive: {
    en: 'The workshop did not respond in time.',
    hi: 'वर्कशॉप ने समय पर जवाब नहीं दिया।',
  },
  customer_asked: {
    en: 'You asked us to cancel it.',
    hi: 'आपने हमसे इसे रद्द करने को कहा था।',
  },
  duplicate_booking: {
    en: 'It was a duplicate of another booking.',
    hi: 'यह किसी दूसरी बुकिंग की दोहरी प्रति थी।',
  },
  policy_violation: {
    en: 'It could not go ahead under our service rules.',
    hi: 'हमारे नियमों के तहत यह आगे नहीं बढ़ सका।',
  },
  other: {
    en: 'We were not able to go ahead with this booking.',
    hi: 'हम इस बुकिंग को आगे नहीं बढ़ा पाए।',
  },
};

const METHOD: Readonly<Record<string, Pair>> = {
  cod: { en: 'Cash on delivery', hi: 'डिलीवरी पर नकद' },
  online: { en: 'Online payment', hi: 'ऑनलाइन पेमेंट' },
  card: { en: 'Card', hi: 'कार्ड' },
  upi: { en: 'UPI', hi: 'UPI' },
  netbanking: { en: 'Net banking', hi: 'नेट बैंकिंग' },
  wallet: { en: 'Wallet', hi: 'वॉलेट' },
  emi: { en: 'EMI', hi: 'EMI' },
  cash: { en: 'Cash', hi: 'नकद' },
};

const SLOT: Readonly<Record<string, Pair>> = {
  morning: { en: 'morning', hi: 'सुबह' },
  afternoon: { en: 'afternoon', hi: 'दोपहर' },
  evening: { en: 'evening', hi: 'शाम' },
};

const pick = (table: Readonly<Record<string, Pair>>, code: string | null | undefined, locale: PhraseLocale) =>
  (table[code ?? ''] ?? table.other)?.[locale] ?? '';

export const cancelReasonPhrase = (code: string | null, locale: PhraseLocale): string =>
  pick(CANCEL_REASON, code, locale);
export const serviceCancelReasonPhrase = (code: string | null, locale: PhraseLocale): string =>
  pick(SERVICE_CANCEL_REASON, code, locale);
export const rejectReasonPhrase = (code: string | null, locale: PhraseLocale): string =>
  pick(REJECT_REASON, code, locale);
export const warningReasonPhrase = (code: string | null, locale: PhraseLocale): string =>
  pick(WARNING_REASON, code, locale);
export const applicationReasonPhrase = (code: string | null, locale: PhraseLocale): string =>
  pick(APPLICATION_REASON, code, locale);
export const paymentMethodPhrase = (method: string | null, locale: PhraseLocale): string =>
  METHOD[method ?? '']?.[locale] ?? method ?? (locale === 'hi' ? 'ऑनलाइन पेमेंट' : 'Online payment');
export const slotPhrase = (slot: string, locale: PhraseLocale): string => SLOT[slot]?.[locale] ?? slot;

/**
 * What the customer is told about money when an order ends without delivery. Honest by construction: nothing is
 * called "refunded" here (that is the refund email's job, once the refund is processed). Unpaid or COD orders
 * have nothing to refund.
 */
export function refundNotePhrase(paidOnline: boolean, locale: PhraseLocale): string {
  if (!paidOnline)
    return locale === 'hi'
      ? 'आपने अभी कोई पेमेंट नहीं किया है, इसलिए रिफंड की कोई ज़रूरत नहीं है।'
      : 'You have not paid anything for this order, so there is nothing to refund.';
  return locale === 'hi'
    ? 'आपने ऑनलाइन पेमेंट किया था। हम रिफंड शुरू कर रहे हैं और मंज़ूरी मिलते ही आपको अलग से ईमेल भेजेंगे।'
    : 'You paid online, so we are starting your refund. We will email you again once it is approved.';
}

export const rupees = (paise: number): string => formatINR(paise);

/** `2026-11-20` → "20 Nov 2026" / "20 नव॰ 2026" (IST calendar date, no clock time). */
export function emailDate(isoDate: string, locale: PhraseLocale): string {
  const d = new Date(`${isoDate}T00:00:00+05:30`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    timeZone: IST_TIMEZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}
