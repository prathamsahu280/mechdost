/**
 * The email catalogue (spec 10, design 2026-11-15): one definition per customer-visible milestone, with default
 * copy in English and Hindi. `text` is the closed list of placeholders the copy may use (and admin overrides may
 * use); `params` are all the payload keys the template reads (the invite token only builds the button link).
 * Order of paragraphs: blank line = new paragraph; one line break stays inside a paragraph.
 * Wording rules: never say "refunded" before it is (only `refund_processed` does); the delivery code is only for
 * the person at the door; sellers never see customer contact details.
 */
import type { EmailPurpose } from './email-templates';

export interface EmailCopy {
  subject: string;
  heading: string;
  body: string;
  /** Button label; null when the template has no button. */
  button: string | null;
}

export interface EmailTemplateDef {
  purpose: EmailPurpose;
  category: 'transactional' | 'promotional';
  audience: 'customer' | 'partner';
  /** Placeholders usable in the text. */
  text: readonly string[];
  /** Every payload key the template reads. */
  params: readonly string[];
  /** Path (without the /hi prefix) the button opens; null = no button. */
  button: ((p: Record<string, string>) => string) | null;
  sample: Record<string, string>;
  en: EmailCopy;
  hi: EmailCopy;
}

const enc = encodeURIComponent;
const order = (p: Record<string, string>) => `/orders/${enc(p.orderCode ?? '')}`;
const service = (p: Record<string, string>) => `/service/${enc(p.requestCode ?? '')}`;
const ticket = (p: Record<string, string>) => `/account/support?ticket=${enc(p.ticketCode ?? '')}`;
const partnerHome = () => '/partner/shop';

const T = {
  customer: 'customer',
  partner: 'partner',
} as const;

const def = (d: EmailTemplateDef): EmailTemplateDef => d;

export const EMAIL_CATALOGUE = {
  // ----- Orders ----------------------------------------------------------------------------------------------
  order_placed: def({
    purpose: 'updates',
    category: 'transactional',
    audience: T.customer,
    text: ['orderCode', 'items', 'total', 'paymentMethod'],
    params: ['orderCode', 'items', 'total', 'paymentMethod'],
    button: order,
    sample: {
      orderCode: 'MD-RPR-2026-4K7Q2M',
      items: 'Brake pad set × 1\nEngine oil 10W-30 × 2',
      total: '₹3,240.00',
      paymentMethod: 'Cash on delivery',
    },
    en: {
      subject: 'We got your order {orderCode}',
      heading: 'Your order is placed',
      body: 'Thank you for ordering on MechDost. Your order {orderCode} has been placed.\n\n{items}\n\nTotal: {total}\nPayment: {paymentMethod}\n\nWe are now confirming it with a seller near you. You will get another email as soon as a seller confirms.',
      button: 'View your order',
    },
    hi: {
      subject: 'आपका ऑर्डर {orderCode} मिल गया',
      heading: 'आपका ऑर्डर दर्ज हो गया है',
      body: 'MechDost पर ऑर्डर करने के लिए धन्यवाद। आपका ऑर्डर {orderCode} दर्ज हो गया है।\n\n{items}\n\nकुल: {total}\nपेमेंट: {paymentMethod}\n\nहम अभी आपके पास के किसी विक्रेता से इसकी पुष्टि करा रहे हैं। विक्रेता के पुष्टि करते ही आपको दूसरा ईमेल मिलेगा।',
      button: 'अपना ऑर्डर देखें',
    },
  }),
  order_confirmed: def({
    purpose: 'updates',
    category: 'transactional',
    audience: T.customer,
    text: ['orderCode', 'shopArea'],
    params: ['orderCode', 'shopArea'],
    button: order,
    sample: { orderCode: 'MD-RPR-2026-4K7Q2M', shopArea: 'Pandri, Raipur' },
    en: {
      subject: 'Order {orderCode} is confirmed',
      heading: 'Confirmed, and it will be shipped',
      body: 'Good news: a seller in {shopArea} has confirmed your order {orderCode}.\n\nIt will be shipped soon. We will email you again when it is out for delivery.',
      button: 'Track your order',
    },
    hi: {
      subject: 'ऑर्डर {orderCode} की पुष्टि हो गई',
      heading: 'पुष्टि हो गई, जल्द भेजा जाएगा',
      body: 'अच्छी खबर: {shopArea} के एक विक्रेता ने आपके ऑर्डर {orderCode} की पुष्टि कर दी है।\n\nइसे जल्द ही भेजा जाएगा। जब यह डिलीवरी के लिए निकलेगा, हम आपको ईमेल करेंगे।',
      button: 'ऑर्डर ट्रैक करें',
    },
  }),
  order_out_for_delivery: def({
    purpose: 'updates',
    category: 'transactional',
    audience: T.customer,
    text: ['orderCode', 'deliveryCode'],
    params: ['orderCode', 'deliveryCode'],
    button: order,
    sample: { orderCode: 'MD-RPR-2026-4K7Q2M', deliveryCode: '4821' },
    en: {
      subject: 'Order {orderCode} is out for delivery',
      heading: 'Your order is on its way',
      body: 'Your order {orderCode} is out for delivery.\n\nYour delivery code: {deliveryCode}\n\nShare this code only with the delivery person, at your door and only when you hold the parcel. MechDost staff will never ask you for it by phone, message or email.',
      button: 'Track your order',
    },
    hi: {
      subject: 'ऑर्डर {orderCode} डिलीवरी के लिए निकल गया है',
      heading: 'आपका ऑर्डर रास्ते में है',
      body: 'आपका ऑर्डर {orderCode} डिलीवरी के लिए निकल गया है।\n\nआपका डिलीवरी कोड: {deliveryCode}\n\nयह कोड सिर्फ़ दरवाज़े पर, पार्सल हाथ में लेने के बाद, डिलीवरी करने वाले को ही बताएं। MechDost का कोई भी व्यक्ति फ़ोन, मैसेज या ईमेल पर यह कोड कभी नहीं माँगेगा।',
      button: 'ऑर्डर ट्रैक करें',
    },
  }),
  order_delivered: def({
    purpose: 'updates',
    category: 'transactional',
    audience: T.customer,
    text: ['orderCode'],
    params: ['orderCode'],
    button: order,
    sample: { orderCode: 'MD-RPR-2026-4K7Q2M' },
    en: {
      subject: 'Order {orderCode} was delivered',
      heading: 'Delivered, thank you',
      body: 'Your order {orderCode} has been delivered. Thank you for choosing MechDost.\n\nA short review helps other drivers choose well, and helps good sellers get noticed.',
      button: 'Review your order',
    },
    hi: {
      subject: 'ऑर्डर {orderCode} डिलीवर हो गया',
      heading: 'डिलीवर हो गया, धन्यवाद',
      body: 'आपका ऑर्डर {orderCode} डिलीवर हो गया है। MechDost चुनने के लिए धन्यवाद।\n\nआपका एक छोटा सा रिव्यू दूसरे ग्राहकों को सही चुनाव करने में मदद करता है और अच्छे विक्रेताओं की पहचान बढ़ाता है।',
      button: 'रिव्यू लिखें',
    },
  }),
  order_cancelled: def({
    purpose: 'updates',
    category: 'transactional',
    audience: T.customer,
    text: ['orderCode', 'reason', 'refundNote'],
    params: ['orderCode', 'reason', 'refundNote'],
    button: order,
    sample: {
      orderCode: 'MD-RPR-2026-4K7Q2M',
      reason: 'The order was cancelled because you changed your mind.',
      refundNote:
        'You paid online, so we are starting your refund. We will email you again once it is approved.',
    },
    en: {
      subject: 'Order {orderCode} was cancelled',
      heading: 'Your order is cancelled',
      body: 'Your order {orderCode} has been cancelled.\n\n{reason}\n\n{refundNote}',
      button: 'View your order',
    },
    hi: {
      subject: 'ऑर्डर {orderCode} रद्द हो गया',
      heading: 'आपका ऑर्डर रद्द हो गया है',
      body: 'आपका ऑर्डर {orderCode} रद्द कर दिया गया है।\n\n{reason}\n\n{refundNote}',
      button: 'ऑर्डर देखें',
    },
  }),
  order_rejected: def({
    purpose: 'updates',
    category: 'transactional',
    audience: T.customer,
    text: ['orderCode', 'reason', 'message', 'refundNote'],
    params: ['orderCode', 'reason', 'message', 'refundNote'],
    button: order,
    sample: {
      orderCode: 'MD-RPR-2026-4K7Q2M',
      reason: 'We could not find a seller with this item in stock near you.',
      message: 'Sorry for the trouble. Please try again in a few days or call us.',
      refundNote:
        'You paid online, so we are starting your refund. We will email you again once it is approved.',
    },
    en: {
      subject: 'We could not fulfil order {orderCode}',
      heading: 'We are sorry, we could not fulfil your order',
      body: 'We could not fulfil your order {orderCode}.\n\n{reason}\n\n{message}\n\n{refundNote}',
      button: 'View your order',
    },
    hi: {
      subject: 'हम ऑर्डर {orderCode} पूरा नहीं कर पाए',
      heading: 'क्षमा करें, हम आपका ऑर्डर पूरा नहीं कर पाए',
      body: 'हम आपका ऑर्डर {orderCode} पूरा नहीं कर पाए।\n\n{reason}\n\n{message}\n\n{refundNote}',
      button: 'ऑर्डर देखें',
    },
  }),
  // ----- Payments and refunds --------------------------------------------------------------------------------
  payment_received: def({
    purpose: 'billing',
    category: 'transactional',
    audience: T.customer,
    text: ['orderCode', 'amount', 'method', 'paymentId'],
    params: ['orderCode', 'amount', 'method', 'paymentId'],
    button: order,
    sample: {
      orderCode: 'MD-RPR-2026-4K7Q2M',
      amount: '₹3,240.00',
      method: 'UPI',
      paymentId: 'pay_Qx7Lm2Hs9Kd01a',
    },
    en: {
      subject: 'Payment received for {orderCode}',
      heading: 'We received your payment',
      body: 'We received your payment of {amount} for order {orderCode}.\n\nMethod: {method}\nPayment id: {paymentId}\n\nKeep this email for your records. We are now confirming your order with a seller.',
      button: 'View your order',
    },
    hi: {
      subject: '{orderCode} का पेमेंट मिल गया',
      heading: 'आपका पेमेंट मिल गया है',
      body: 'ऑर्डर {orderCode} के लिए आपका {amount} का पेमेंट हमें मिल गया है।\n\nतरीका: {method}\nपेमेंट आईडी: {paymentId}\n\nअपने रिकॉर्ड के लिए यह ईमेल संभालकर रखें। अब हम किसी विक्रेता से आपके ऑर्डर की पुष्टि करा रहे हैं।',
      button: 'ऑर्डर देखें',
    },
  }),
  refund_requested: def({
    purpose: 'billing',
    category: 'transactional',
    audience: T.customer,
    text: ['orderCode', 'amount'],
    params: ['orderCode', 'amount'],
    button: order,
    sample: { orderCode: 'MD-RPR-2026-4K7Q2M', amount: '₹3,240.00' },
    en: {
      subject: 'Refund requested for {orderCode}',
      heading: 'Your refund is being reviewed',
      body: 'We have started a refund of {amount} for order {orderCode}.\n\nFirst we approve it, which we do as quickly as we can. After approval your bank or payment app usually takes 5 to 7 working days to show the money. It goes back to the same payment method you used.',
      button: 'View your order',
    },
    hi: {
      subject: '{orderCode} के लिए रिफंड का अनुरोध दर्ज हुआ',
      heading: 'आपके रिफंड की जाँच हो रही है',
      body: 'हमने ऑर्डर {orderCode} के लिए {amount} का रिफंड शुरू किया है।\n\nपहले हम इसे मंज़ूर करते हैं, जो हम जितनी जल्दी हो सके करते हैं। मंज़ूरी के बाद आपके बैंक या पेमेंट ऐप में पैसे दिखने में आमतौर पर 5 से 7 कार्य-दिवस लगते हैं। पैसे उसी पेमेंट तरीके से वापस जाएँगे जिससे आपने भुगतान किया था।',
      button: 'ऑर्डर देखें',
    },
  }),
  refund_processed: def({
    purpose: 'billing',
    category: 'transactional',
    audience: T.customer,
    text: ['orderCode', 'amount'],
    params: ['orderCode', 'amount'],
    button: order,
    sample: { orderCode: 'MD-RPR-2026-4K7Q2M', amount: '₹3,240.00' },
    en: {
      subject: 'Refund processed for {orderCode}',
      heading: 'Your refund is on its way to you',
      body: 'We have processed your refund of {amount} for order {orderCode}. It goes back to the payment method you used.\n\nYour bank or payment app may take 5 to 7 working days to show it. If it has not arrived after that, write to us and we will help.',
      button: 'View your order',
    },
    hi: {
      subject: '{orderCode} का रिफंड भेज दिया गया',
      heading: 'आपका रिफंड आप तक आ रहा है',
      body: 'हमने ऑर्डर {orderCode} का {amount} का रिफंड भेज दिया है। यह उसी पेमेंट तरीके में वापस जाएगा जिससे आपने भुगतान किया था।\n\nआपके बैंक या पेमेंट ऐप में दिखने में 5 से 7 कार्य-दिवस लग सकते हैं। इसके बाद भी न आए तो हमें लिखें, हम मदद करेंगे।',
      button: 'ऑर्डर देखें',
    },
  }),
  refund_failed: def({
    purpose: 'billing',
    category: 'transactional',
    audience: T.customer,
    text: ['orderCode', 'amount'],
    params: ['orderCode', 'amount'],
    button: order,
    sample: { orderCode: 'MD-RPR-2026-4K7Q2M', amount: '₹3,240.00' },
    en: {
      subject: 'We need to retry your refund for {orderCode}',
      heading: 'Your refund did not go through yet',
      body: 'The refund of {amount} for order {orderCode} did not go through the first time. Your money is safe and we are looking into it.\n\nYou do not need to do anything. If we need something from you, our support team will contact you.',
      button: 'View your order',
    },
    hi: {
      subject: '{orderCode} का रिफंड दोबारा करना होगा',
      heading: 'आपका रिफंड अभी पूरा नहीं हो पाया',
      body: 'ऑर्डर {orderCode} का {amount} का रिफंड पहली बार में पूरा नहीं हो पाया। आपके पैसे सुरक्षित हैं और हम इसे देख रहे हैं।\n\nआपको कुछ करने की ज़रूरत नहीं है। हमें आपसे कुछ चाहिए होगा तो हमारी सहायता टीम आपसे संपर्क करेगी।',
      button: 'ऑर्डर देखें',
    },
  }),
  /** Finance declined a refund request (spec 05; every refund needs an approval, decision 2026-11-15). */
  refund_declined: def({
    purpose: 'billing',
    category: 'transactional',
    audience: T.customer,
    text: ['orderCode', 'amount'],
    params: ['orderCode', 'amount'],
    button: () => '/support',
    sample: { orderCode: 'MD-RPR-2026-4K7Q2M', amount: '₹3,240.00' },
    en: {
      subject: 'About your refund for {orderCode}',
      heading: 'We could not approve this refund',
      body: 'We could not approve the refund of {amount} for order {orderCode}.\n\nPlease contact support to understand why or to have it looked at again.',
      button: 'Contact support',
    },
    hi: {
      subject: '{orderCode} के रिफंड के बारे में',
      heading: 'हम यह रिफंड मंज़ूर नहीं कर सके',
      body: 'ऑर्डर {orderCode} के {amount} के रिफंड का अनुरोध हम मंज़ूर नहीं कर सके।\n\nकारण जानने या इसे दोबारा देखने के लिए सहायता टीम से संपर्क करें।',
      button: 'सहायता से संपर्क करें',
    },
  }),
  // ----- Service requests ------------------------------------------------------------------------------------
  service_request_received: def({
    purpose: 'updates',
    category: 'transactional',
    audience: T.customer,
    text: ['requestCode', 'workshop'],
    params: ['requestCode', 'workshop'],
    button: service,
    sample: { requestCode: 'SR-RPR-2026-7M2P9X', workshop: 'Sharma Auto Works, Pandri' },
    en: {
      subject: 'We got your service request {requestCode}',
      heading: 'Your service request is in',
      body: 'We have your service request {requestCode}. It is with: {workshop}.\n\nThe workshop will propose a time and an expected cost. You decide whether it suits you, and nothing is booked until you accept.',
      button: 'View your request',
    },
    hi: {
      subject: 'आपका सर्विस अनुरोध {requestCode} मिल गया',
      heading: 'आपका सर्विस अनुरोध दर्ज हो गया है',
      body: 'हमें आपका सर्विस अनुरोध {requestCode} मिल गया है। यह यहाँ भेजा गया है: {workshop}।\n\nवर्कशॉप आपको समय और अनुमानित खर्च बताएगी। आपको ठीक लगे तभी आप हाँ कहें, उससे पहले कुछ बुक नहीं होता।',
      button: 'अनुरोध देखें',
    },
  }),
  service_proposed: def({
    purpose: 'updates',
    category: 'transactional',
    audience: T.customer,
    text: ['requestCode', 'workshopName', 'slot', 'expectedCost'],
    params: ['requestCode', 'workshopName', 'slot', 'expectedCost'],
    button: service,
    sample: {
      requestCode: 'SR-RPR-2026-7M2P9X',
      workshopName: 'Sharma Auto Works',
      slot: '20 Nov 2026, morning',
      expectedCost: '₹800.00 to ₹1,200.00',
    },
    en: {
      subject: '{workshopName} proposed a time for {requestCode}',
      heading: 'Please review the proposed time and cost',
      body: '{workshopName} has proposed a visit for your request {requestCode}.\n\nWhen: {slot}\nExpected cost: {expectedCost}\n\nThis is an estimate, and the final price is agreed with you line by line before any work starts. Please accept the time if it suits you, or ask for another.',
      button: 'Review and answer',
    },
    hi: {
      subject: '{workshopName} ने {requestCode} के लिए समय बताया है',
      heading: 'कृपया बताया गया समय और खर्च देखें',
      body: '{workshopName} ने आपके अनुरोध {requestCode} के लिए आने का समय बताया है।\n\nकब: {slot}\nअनुमानित खर्च: {expectedCost}\n\nयह सिर्फ़ अनुमान है। काम शुरू होने से पहले अंतिम कीमत आपके साथ हर मद के हिसाब से तय होगी। समय ठीक लगे तो स्वीकार करें, नहीं तो दूसरा समय माँगें।',
      button: 'देखें और जवाब दें',
    },
  }),
  service_confirmed: def({
    purpose: 'updates',
    category: 'transactional',
    audience: T.customer,
    text: ['requestCode', 'workshopName', 'slot'],
    params: ['requestCode', 'workshopName', 'slot'],
    button: service,
    sample: {
      requestCode: 'SR-RPR-2026-7M2P9X',
      workshopName: 'Sharma Auto Works',
      slot: '20 Nov 2026, morning',
    },
    en: {
      subject: 'Your visit is confirmed ({requestCode})',
      heading: 'Your workshop visit is confirmed',
      body: 'Your visit to {workshopName} is confirmed for {slot}.\n\nBring your vehicle at that time. The workshop will note the odometer reading when it receives the vehicle and will send you an itemised estimate to approve before any work starts.',
      button: 'View your booking',
    },
    hi: {
      subject: 'आपकी विज़िट पक्की हो गई ({requestCode})',
      heading: 'वर्कशॉप की आपकी विज़िट पक्की है',
      body: '{workshopName} में आपकी विज़िट {slot} के लिए पक्की हो गई है।\n\nउस समय अपना वाहन लेकर पहुँचें। वाहन लेते समय वर्कशॉप ओडोमीटर की रीडिंग दर्ज करेगी और किसी भी काम से पहले आपको मद-वार अनुमान भेजेगी, जिसे आपको मंज़ूर करना होगा।',
      button: 'बुकिंग देखें',
    },
  }),
  service_estimate_ready: def({
    purpose: 'updates',
    category: 'transactional',
    audience: T.customer,
    text: ['requestCode', 'workshopName'],
    params: ['requestCode', 'workshopName'],
    button: service,
    sample: { requestCode: 'SR-RPR-2026-7M2P9X', workshopName: 'Sharma Auto Works' },
    en: {
      subject: 'Your estimate is ready ({requestCode})',
      heading: 'Please approve the work, line by line',
      body: '{workshopName} has sent the itemised estimate for your request {requestCode}.\n\nYou can approve or decline every line. Only the lines you approve will be done and billed. The work does not start until you answer.',
      button: 'Review the estimate',
    },
    hi: {
      subject: 'आपका अनुमान तैयार है ({requestCode})',
      heading: 'कृपया काम को मद-दर-मद मंज़ूर करें',
      body: '{workshopName} ने आपके अनुरोध {requestCode} का मद-वार अनुमान भेजा है।\n\nहर मद को आप मंज़ूर या अस्वीकार कर सकते हैं। सिर्फ़ वही काम होगा और उसी का बिल बनेगा जो आप मंज़ूर करेंगे। आपके जवाब से पहले काम शुरू नहीं होगा।',
      button: 'अनुमान देखें',
    },
  }),
  service_ready: def({
    purpose: 'updates',
    category: 'transactional',
    audience: T.customer,
    text: ['requestCode', 'workshopName'],
    params: ['requestCode', 'workshopName'],
    button: service,
    sample: { requestCode: 'SR-RPR-2026-7M2P9X', workshopName: 'Sharma Auto Works' },
    en: {
      subject: 'Your vehicle is ready ({requestCode})',
      heading: 'Your vehicle is ready',
      body: 'The work on your vehicle at {workshopName} is done. It is ready for you.\n\nThe workshop will prepare the bill next. You can pay once you have it.',
      button: 'View your request',
    },
    hi: {
      subject: 'आपका वाहन तैयार है ({requestCode})',
      heading: 'आपका वाहन तैयार है',
      body: '{workshopName} में आपके वाहन का काम पूरा हो गया है। वाहन आपके लिए तैयार है।\n\nअब वर्कशॉप बिल बनाएगी। बिल मिलने के बाद आप भुगतान कर सकते हैं।',
      button: 'अनुरोध देखें',
    },
  }),
  service_bill_ready: def({
    purpose: 'billing',
    category: 'transactional',
    audience: T.customer,
    text: ['requestCode', 'workshopName', 'amount'],
    params: ['requestCode', 'workshopName', 'amount'],
    button: service,
    sample: { requestCode: 'SR-RPR-2026-7M2P9X', workshopName: 'Sharma Auto Works', amount: '₹1,180.00' },
    en: {
      subject: 'Your bill is ready ({requestCode})',
      heading: 'Your bill is ready',
      body: '{workshopName} has prepared your bill for request {requestCode}.\n\nTotal: {amount}\n\nIt covers only the work you approved. You can see every line on the request page.',
      button: 'View the bill',
    },
    hi: {
      subject: 'आपका बिल तैयार है ({requestCode})',
      heading: 'आपका बिल तैयार है',
      body: '{workshopName} ने आपके अनुरोध {requestCode} का बिल बना दिया है।\n\nकुल: {amount}\n\nइसमें सिर्फ़ वही काम है जो आपने मंज़ूर किया था। हर मद आप अनुरोध वाले पेज पर देख सकते हैं।',
      button: 'बिल देखें',
    },
  }),
  service_completed: def({
    purpose: 'updates',
    category: 'transactional',
    audience: T.customer,
    text: ['requestCode', 'workshopName'],
    params: ['requestCode', 'workshopName'],
    button: service,
    sample: { requestCode: 'SR-RPR-2026-7M2P9X', workshopName: 'Sharma Auto Works' },
    en: {
      subject: 'Your service is complete ({requestCode})',
      heading: 'Service complete, thank you',
      body: 'Your service request {requestCode} at {workshopName} is complete. Thank you for booking through MechDost.\n\nHow was it? A short review helps other drivers choose a workshop.',
      button: 'Review the workshop',
    },
    hi: {
      subject: 'आपकी सर्विस पूरी हुई ({requestCode})',
      heading: 'सर्विस पूरी हुई, धन्यवाद',
      body: '{workshopName} में आपका सर्विस अनुरोध {requestCode} पूरा हो गया है। MechDost से बुक करने के लिए धन्यवाद।\n\nअनुभव कैसा रहा? आपका छोटा सा रिव्यू दूसरे ग्राहकों को वर्कशॉप चुनने में मदद करता है।',
      button: 'वर्कशॉप का रिव्यू लिखें',
    },
  }),
  // ----- Bulk quotes -----------------------------------------------------------------------------------------
  /** MechDost sent (or revised) a bulk price offer (spec 19); the customer accepts it on the quote page. */
  quote_offer: def({
    purpose: 'updates',
    category: 'transactional',
    audience: T.customer,
    text: ['quoteCode', 'validUntil'],
    params: ['quoteCode', 'validUntil'],
    button: (p) => `/quotes/${enc(p.quoteCode ?? '')}`,
    sample: { quoteCode: 'QT-RPR-2026-8N3R4T', validUntil: '25 Nov 2026' },
    en: {
      subject: 'Your bulk price is ready ({quoteCode})',
      heading: 'Your bulk price is ready',
      body: 'MechDost has sent a price for your bulk request.\n\nReview the offer and accept it on the same page if it works for you. The offer is valid until {validUntil}.',
      button: 'View the offer',
    },
    hi: {
      subject: 'आपकी थोक कीमत तैयार है ({quoteCode})',
      heading: 'आपकी थोक कीमत तैयार है',
      body: 'MechDost ने आपके थोक अनुरोध के लिए कीमत भेजी है।\n\nऑफ़र देखें और ठीक लगे तो उसी पेज पर स्वीकार करें। यह ऑफ़र {validUntil} तक मान्य है।',
      button: 'ऑफ़र देखें',
    },
  }),
  /** The offer ends within 24 hours (worker sweep): one reminder per offer. */
  quote_expiring: def({
    purpose: 'updates',
    category: 'transactional',
    audience: T.customer,
    text: ['quoteCode', 'validUntil'],
    params: ['quoteCode', 'validUntil'],
    button: (p) => `/quotes/${enc(p.quoteCode ?? '')}`,
    sample: { quoteCode: 'QT-RPR-2026-8N3R4T', validUntil: '25 Nov 2026' },
    en: {
      subject: 'Your bulk price ends soon ({quoteCode})',
      heading: 'Your bulk price ends soon',
      body: 'The price MechDost sent for your bulk request {quoteCode} is valid until {validUntil}.\n\nIf it works for you, accept it on the offer page before then. After that you can ask us for a new price.',
      button: 'View the offer',
    },
    hi: {
      subject: 'आपकी थोक कीमत जल्द खत्म होने वाली है ({quoteCode})',
      heading: 'आपकी थोक कीमत जल्द खत्म होने वाली है',
      body: 'आपके थोक अनुरोध {quoteCode} के लिए MechDost की भेजी कीमत {validUntil} तक मान्य है।\n\nठीक लगे तो उससे पहले ऑफ़र वाले पेज पर इसे स्वीकार करें। उसके बाद आप हमसे नई कीमत माँग सकते हैं।',
      button: 'ऑफ़र देखें',
    },
  }),
  // ----- Support ---------------------------------------------------------------------------------------------
  ticket_received: def({
    purpose: 'support',
    category: 'transactional',
    audience: T.customer,
    text: ['ticketCode'],
    params: ['ticketCode'],
    button: ticket,
    sample: { ticketCode: 'REQ-RPR-2026-5H8W1V' },
    en: {
      subject: 'We got your request {ticketCode}',
      heading: 'We have your request',
      body: 'Your support request {ticketCode} is with our team. We will reply as soon as we can, usually within one working day.\n\nYou can add details or follow the conversation on the request page.',
      button: 'Open your request',
    },
    hi: {
      subject: 'आपका अनुरोध {ticketCode} मिल गया',
      heading: 'हमें आपका अनुरोध मिल गया है',
      body: 'आपका सहायता अनुरोध {ticketCode} हमारी टीम के पास है। हम जल्द से जल्द जवाब देंगे, आमतौर पर एक कार्य-दिवस में।\n\nआप अनुरोध वाले पेज पर और जानकारी जोड़ सकते हैं या बातचीत देख सकते हैं।',
      button: 'अनुरोध खोलें',
    },
  }),
  ticket_reply: def({
    purpose: 'support',
    category: 'transactional',
    audience: T.customer,
    text: ['ticketCode'],
    params: ['ticketCode'],
    button: ticket,
    sample: { ticketCode: 'REQ-RPR-2026-5H8W1V' },
    en: {
      subject: 'New reply on your request {ticketCode}',
      heading: 'MechDost support replied',
      body: 'Our support team has replied to your request {ticketCode}.\n\nOpen the request to read the reply and answer if we asked you something.',
      button: 'Read the reply',
    },
    hi: {
      subject: 'आपके अनुरोध {ticketCode} पर नया जवाब',
      heading: 'MechDost सहायता ने जवाब दिया है',
      body: 'हमारी सहायता टीम ने आपके अनुरोध {ticketCode} पर जवाब दिया है।\n\nजवाब पढ़ने के लिए अनुरोध खोलें, और अगर हमने कुछ पूछा है तो वहीं उत्तर दें।',
      button: 'जवाब पढ़ें',
    },
  }),
  ticket_resolved: def({
    purpose: 'support',
    category: 'transactional',
    audience: T.customer,
    text: ['ticketCode'],
    params: ['ticketCode'],
    button: ticket,
    sample: { ticketCode: 'REQ-RPR-2026-5H8W1V' },
    en: {
      subject: 'Your request {ticketCode} is resolved',
      heading: 'We have marked your request as resolved',
      body: 'We have marked your support request {ticketCode} as resolved.\n\nIf something is still not right, reply on the request page and we will pick it up again.',
      button: 'Open your request',
    },
    hi: {
      subject: 'आपका अनुरोध {ticketCode} सुलझ गया',
      heading: 'हमने आपका अनुरोध सुलझा हुआ मार्क किया है',
      body: 'हमने आपके सहायता अनुरोध {ticketCode} को सुलझा हुआ मार्क कर दिया है।\n\nअगर कुछ अब भी ठीक नहीं है, तो अनुरोध वाले पेज पर जवाब दें, हम इसे फिर से देखेंगे।',
      button: 'अनुरोध खोलें',
    },
  }),
  // ----- Partners --------------------------------------------------------------------------------------------
  /** An admin invited a seller (design 2026-11-13): the one-time link to the prefilled application. */
  partner_invite: def({
    purpose: 'updates',
    category: 'transactional',
    audience: T.partner,
    text: ['name', 'expiresOn'],
    params: ['name', 'expiresOn', 'token'],
    button: (p) => `/partners/invite/${enc(p.token ?? '')}`,
    sample: { name: 'Asha Verma', expiresOn: '22 Nov 2026', token: 'preview-only' },
    en: {
      subject: 'Your invitation to sell on MechDost',
      heading: 'You are invited to sell on MechDost',
      body: 'Hello {name},\n\nMechDost has invited you to join as a seller. Use the link below to finish your application: your GST number, address, shop location and the products you sell.\n\nThe link works once and is valid until {expiresOn}.',
      button: 'Finish your application',
    },
    hi: {
      subject: 'MechDost पर विक्रेता के रूप में जुड़ने का निमंत्रण',
      heading: 'MechDost पर बेचने के लिए आपको निमंत्रण है',
      body: 'नमस्ते {name},\n\nMechDost ने आपको विक्रेता के रूप में जुड़ने के लिए आमंत्रित किया है। नीचे दिए लिंक से अपना आवेदन पूरा करें: GST नंबर, पता, दुकान की जगह और आप जो प्रोडक्ट बेचते हैं।\n\nयह लिंक {expiresOn} तक मान्य है और केवल एक बार काम करता है।',
      button: 'आवेदन पूरा करें',
    },
  }),
  application_received: def({
    purpose: 'system',
    category: 'transactional',
    audience: T.partner,
    text: ['name', 'applicationCode'],
    params: ['name', 'applicationCode'],
    button: null,
    sample: { name: 'Asha Verma', applicationCode: 'PA-RPR-2026-3D6F8G' },
    en: {
      subject: 'We received your application {applicationCode}',
      heading: 'We received your application',
      body: 'Hello {name},\n\nThank you for applying to sell on MechDost. Your application {applicationCode} is with our team. We check the details and will email you the result. It usually takes a few working days.',
      button: null,
    },
    hi: {
      subject: 'आपका आवेदन {applicationCode} मिल गया',
      heading: 'हमें आपका आवेदन मिल गया है',
      body: 'नमस्ते {name},\n\nMechDost पर बेचने के लिए आवेदन करने का धन्यवाद। आपका आवेदन {applicationCode} हमारी टीम के पास है। हम जानकारी जाँचकर नतीजा आपको ईमेल करेंगे। इसमें आमतौर पर कुछ कार्य-दिवस लगते हैं।',
      button: null,
    },
  }),
  application_approved: def({
    purpose: 'system',
    category: 'transactional',
    audience: T.partner,
    text: ['name', 'applicationCode'],
    params: ['name', 'applicationCode'],
    button: partnerHome,
    sample: { name: 'Asha Verma', applicationCode: 'PA-RPR-2026-3D6F8G' },
    en: {
      subject: 'Your MechDost application is approved',
      heading: 'Welcome to MechDost',
      body: 'Hello {name},\n\nYour application {applicationCode} is approved. Sign in with the mobile number you applied with to open your shop portal, add your prices and start receiving orders.',
      button: 'Open your shop portal',
    },
    hi: {
      subject: 'आपका MechDost आवेदन मंज़ूर हो गया',
      heading: 'MechDost में आपका स्वागत है',
      body: 'नमस्ते {name},\n\nआपका आवेदन {applicationCode} मंज़ूर हो गया है। जिस मोबाइल नंबर से आपने आवेदन किया था, उसी से साइन इन करके अपना शॉप पोर्टल खोलें, दाम जोड़ें और ऑर्डर पाना शुरू करें।',
      button: 'शॉप पोर्टल खोलें',
    },
  }),
  application_rejected: def({
    purpose: 'system',
    category: 'transactional',
    audience: T.partner,
    text: ['name', 'applicationCode', 'reason'],
    params: ['name', 'applicationCode', 'reason'],
    button: null,
    sample: {
      name: 'Asha Verma',
      applicationCode: 'PA-RPR-2026-3D6F8G',
      reason: 'We could not verify the details you gave.',
    },
    en: {
      subject: 'About your MechDost application {applicationCode}',
      heading: 'We are not able to approve your application',
      body: 'Hello {name},\n\nThank you for your interest in selling on MechDost. We are not able to approve application {applicationCode} right now.\n\n{reason}\n\nYou are welcome to apply again once this is sorted out. Call our support line if you would like to talk it through.',
      button: null,
    },
    hi: {
      subject: 'आपके MechDost आवेदन {applicationCode} के बारे में',
      heading: 'हम अभी आपका आवेदन मंज़ूर नहीं कर पा रहे',
      body: 'नमस्ते {name},\n\nMechDost पर बेचने में रुचि दिखाने का धन्यवाद। हम अभी आवेदन {applicationCode} को मंज़ूर नहीं कर पा रहे हैं।\n\n{reason}\n\nयह ठीक हो जाने पर आप दोबारा आवेदन कर सकते हैं। बात करना चाहें तो हमारी सहायता लाइन पर कॉल करें।',
      button: null,
    },
  }),
  shop_order_routed: def({
    purpose: 'updates',
    category: 'transactional',
    audience: T.partner,
    text: ['orderCode', 'minutes'],
    params: ['orderCode', 'minutes'],
    button: partnerHome,
    sample: { orderCode: 'MD-RPR-2026-4K7Q2M', minutes: '30' },
    en: {
      subject: 'New order {orderCode} is waiting for you',
      heading: 'A new order is waiting for you',
      body: 'MechDost has offered you order {orderCode}.\n\nPlease accept or decline it within {minutes} minutes in your shop portal. If we do not hear from you in time, the order goes to another seller.',
      button: 'Open the order',
    },
    hi: {
      subject: 'नया ऑर्डर {orderCode} आपका इंतज़ार कर रहा है',
      heading: 'आपके लिए एक नया ऑर्डर है',
      body: 'MechDost ने आपको ऑर्डर {orderCode} भेजा है।\n\nकृपया अपने शॉप पोर्टल में {minutes} मिनट के अंदर इसे स्वीकार या अस्वीकार करें। समय पर जवाब न मिला तो ऑर्डर किसी दूसरे विक्रेता को चला जाएगा।',
      button: 'ऑर्डर खोलें',
    },
  }),
  partner_warning_issued: def({
    purpose: 'system',
    category: 'transactional',
    audience: T.partner,
    text: ['name', 'reason', 'count', 'windowDays'],
    params: ['name', 'reason', 'count', 'windowDays'],
    button: partnerHome,
    sample: {
      name: 'Asha Verma',
      reason: 'several order requests were not answered in time',
      count: '2',
      windowDays: '30',
    },
    en: {
      subject: 'A note from MechDost about your shop',
      heading: 'A note from MechDost',
      body: 'Hello {name},\n\nWe are writing to let you know that {reason}. This is a note, not a penalty, and it is on your record so that you can see it too.\n\nYou have {count} note(s) in the last {windowDays} days. Many of these can be avoided with small changes, and we are happy to help. If you think this note is a mistake, reply to this email or call support.',
      button: 'See your notes',
    },
    hi: {
      subject: 'आपकी दुकान के बारे में MechDost का एक नोट',
      heading: 'MechDost की तरफ़ से एक नोट',
      body: 'नमस्ते {name},\n\nहम आपको बताना चाहते हैं कि {reason}। यह एक नोट है, कोई जुर्माना नहीं, और यह आपके रिकॉर्ड में है ताकि आप भी इसे देख सकें।\n\nपिछले {windowDays} दिनों में आपके {count} नोट हैं। इनमें से कई छोटे बदलावों से टल सकते हैं, और हम मदद करने को तैयार हैं। अगर आपको लगता है कि यह नोट गलती से आया है, तो इस ईमेल का जवाब दें या सहायता को कॉल करें।',
      button: 'अपने नोट देखें',
    },
  }),
} as const satisfies Record<string, EmailTemplateDef>;
