/**
 * The bill / receipt document that rides on the bill emails as a PDF (user 2026-11-16, Q194; spec 10). A pure model:
 * it is built only from the stored bill or order snapshot (integer paise, never recomputed differently), so the PDF
 * can never disagree with the screen or the ledger. Rendering lives in the API (`apps/api/src/notify/pdf`).
 *
 * Titled "Bill" or "Receipt", never "Tax invoice": who issues the GST invoice is open (Q97), and the gapless
 * invoice numbers belong to finalised invoices, not to this copy for the customer's records.
 */
import { EMAIL_SUPPORT_PHONE } from './email-layout';
import { paymentMethodPhrase } from './email-phrases';
import type { ServiceBill } from './service-bill';
import { istDateString } from './time';

export type BillLocale = 'en' | 'hi';

/** The email templates that carry the PDF; no other email ever gets an attachment. */
export const BILL_ATTACHMENT_TEMPLATES = [
  'service_bill_ready',
  'service_completed',
  'order_delivered',
  'payment_received',
] as const;
export type BillAttachmentTemplate = (typeof BILL_ATTACHMENT_TEMPLATES)[number];

export const isBillAttachmentTemplate = (key: string): key is BillAttachmentTemplate =>
  (BILL_ATTACHMENT_TEMPLATES as readonly string[]).includes(key);

/** The outbox payload key that holds the id of the bill's owner row (request, sub-order or payment): ids only, no PII. */
export const BILL_REF_KEY = 'billRef';

/** Largest PDF an email may carry; a bigger one is left off (the mail itself still goes). */
export const BILL_PDF_MAX_BYTES = 1_500_000;

export type BillKind = 'service_bill' | 'order_receipt';
export type BillTotalKey =
  'taxable' | 'cgst' | 'sgst' | 'roundOff' | 'subtotal' | 'discount' | 'delivery' | 'codFee' | 'gstIncluded';

export interface BillDocLine {
  description: string;
  qty: number;
  unitPaise: number;
  /** Service lines only; null on an order receipt (the price there already includes GST). */
  gstRateBp: number | null;
  amountPaise: number;
}

export interface BillDocument {
  kind: BillKind;
  locale: BillLocale;
  /** "Bill" or "Receipt" in the document's language. */
  title: string;
  /** The service request code (SR-…) or the order code (MD-…). */
  code: string;
  /** IST calendar date, YYYY-MM-DD. */
  issuedOn: string;
  /** The workshop that did the work (a service bill); null on an order receipt, whose seller stays unnamed. */
  partyName: string | null;
  customerName: string | null;
  vehicle: string | null;
  lines: BillDocLine[];
  /** Rows above the grand total, signed (a discount is negative); zero rows are left out. */
  totals: { key: BillTotalKey; paise: number }[];
  totalPaise: number;
  payment: {
    status: 'paid' | 'pending' | 'cod';
    /** The method in words, in the document's language; null when unknown. */
    method: string | null;
    paidOn: string | null;
  };
}

export interface ServiceBillSource {
  code: string;
  workshopName: string;
  workshopNameHi: string | null;
  customerName: string | null;
  vehicleText: string;
  bill: ServiceBill & {
    gstRegistered: boolean;
    billedAt: Date;
    paidAt: Date | null;
    method: string | null;
  };
}

export interface OrderReceiptSource {
  /** `order` = one delivered sub-order, `payment` = the whole paid checkout; same layout. */
  kind: 'order' | 'payment';
  code: string;
  customerName: string | null;
  issuedAt: Date;
  items: {
    title: string;
    titleHi: string | null;
    qty: number;
    unitPaise: number;
    totalPaise: number;
    /** CGST + SGST + IGST of the line, already inside `totalPaise`. */
    gstPaise: number;
  }[];
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  codFeePaise: number;
  totalPaise: number;
  paymentMethod: 'online' | 'cod';
  paymentStatus: string;
  /** The gateway's method code (upi, card…), when known. */
  paidMethod: string | null;
}

interface Labels {
  billTitle: string;
  receiptTitle: string;
  billCode: string;
  orderCode: string;
  date: string;
  workshop: string;
  customer: string;
  vehicle: string;
  description: string;
  qty: string;
  rate: string;
  gst: string;
  amount: string;
  total: string;
  totals: Record<BillTotalKey, string>;
  visitFee: string;
  paid: string;
  pending: string;
  cod: string;
  method: string;
  paidOn: string;
  support: string;
  copyNote: string;
}

const LABELS: Record<BillLocale, Labels> = {
  en: {
    billTitle: 'Bill',
    receiptTitle: 'Receipt',
    billCode: 'Service request',
    orderCode: 'Order',
    date: 'Date',
    workshop: 'Workshop',
    customer: 'Customer',
    vehicle: 'Vehicle',
    description: 'Item',
    qty: 'Qty',
    rate: 'Rate',
    gst: 'GST',
    amount: 'Amount',
    total: 'Total',
    totals: {
      taxable: 'Taxable amount',
      cgst: 'CGST',
      sgst: 'SGST',
      roundOff: 'Round off',
      subtotal: 'Subtotal',
      discount: 'Discount',
      delivery: 'Delivery',
      codFee: 'Cash on delivery fee',
      gstIncluded: 'GST included above',
    },
    visitFee: 'Home visit fee',
    paid: 'Paid',
    pending: 'Payment pending',
    cod: 'Pay on delivery',
    method: 'Method',
    paidOn: 'Paid on',
    support: 'Questions? Call or WhatsApp MechDost support on',
    copyNote: 'This is your copy for your records.',
  },
  hi: {
    billTitle: 'बिल',
    receiptTitle: 'रसीद',
    billCode: 'सर्विस अनुरोध',
    orderCode: 'ऑर्डर',
    date: 'तारीख',
    workshop: 'वर्कशॉप',
    customer: 'ग्राहक',
    vehicle: 'वाहन',
    description: 'विवरण',
    qty: 'मात्रा',
    rate: 'दर',
    gst: 'GST',
    amount: 'राशि',
    total: 'कुल',
    totals: {
      taxable: 'कर योग्य राशि',
      cgst: 'CGST',
      sgst: 'SGST',
      roundOff: 'राउंड-ऑफ',
      subtotal: 'उप-योग',
      discount: 'छूट',
      delivery: 'डिलीवरी',
      codFee: 'कैश ऑन डिलीवरी शुल्क',
      gstIncluded: 'इसमें GST शामिल',
    },
    visitFee: 'घर पर विज़िट शुल्क',
    paid: 'भुगतान हो गया',
    pending: 'भुगतान बाकी',
    cod: 'डिलीवरी पर भुगतान',
    method: 'तरीका',
    paidOn: 'भुगतान की तारीख',
    support: 'सवाल? MechDost सहायता को कॉल या WhatsApp करें:',
    copyNote: 'यह आपके रिकॉर्ड के लिए आपकी प्रति है।',
  },
};

export const billLabels = (locale: BillLocale): Labels => LABELS[locale];

export const billSupportPhone = EMAIL_SUPPORT_PHONE;

/** `MechDost-bill-SR-XXXX.pdf`: only letters, digits and dashes of the code survive, so a name can never be a path. */
export function billFilename(code: string, kind: BillKind): string {
  const safe = code.replace(/[^A-Za-z0-9-]/g, '').replace(/^-+/, '') || 'document';
  return `MechDost-${kind === 'service_bill' ? 'bill' : 'receipt'}-${safe}.pdf`;
}

const signedRows = (rows: [BillTotalKey, number][], keepZero: BillTotalKey[]) =>
  rows
    .filter(([key, paise]) => paise !== 0 || keepZero.includes(key))
    .map(([key, paise]) => ({ key, paise }));

export function serviceBillDocument(src: ServiceBillSource, locale: BillLocale): BillDocument {
  const l = LABELS[locale];
  const { bill } = src;
  const lines: BillDocLine[] = bill.lines.map((line) => ({
    description: line.kind === 'visit_fee' ? l.visitFee : line.description,
    qty: line.qty,
    unitPaise: line.unitPaise,
    gstRateBp: line.gstRateBp,
    amountPaise: line.taxablePaise,
  }));
  const rows: [BillTotalKey, number][] = [['taxable', bill.taxablePaise]];
  if (bill.gstRegistered) rows.push(['cgst', bill.cgstPaise], ['sgst', bill.sgstPaise]);
  rows.push(['roundOff', bill.roundOffPaise]);
  const paid = bill.paidAt !== null;
  return {
    kind: 'service_bill',
    locale,
    title: l.billTitle,
    code: src.code,
    issuedOn: istDateString(bill.billedAt),
    partyName: locale === 'hi' && src.workshopNameHi ? src.workshopNameHi : src.workshopName,
    customerName: src.customerName,
    vehicle: src.vehicleText || null,
    lines,
    totals: signedRows(rows, ['taxable']),
    totalPaise: bill.totalPaise,
    payment: {
      status: paid ? 'paid' : 'pending',
      method: paid && bill.method ? paymentMethodPhrase(bill.method, locale) : null,
      paidOn: bill.paidAt ? istDateString(bill.paidAt) : null,
    },
  };
}

export function orderReceiptDocument(src: OrderReceiptSource, locale: BillLocale): BillDocument {
  const l = LABELS[locale];
  const gst = src.items.reduce((s, i) => s + i.gstPaise, 0);
  const rows: [BillTotalKey, number][] = [
    ['subtotal', src.subtotalPaise],
    ['discount', -src.discountPaise],
    ['delivery', src.shippingPaise],
    ['codFee', src.codFeePaise],
    ['gstIncluded', gst],
  ];
  const paid =
    src.paymentMethod === 'online'
      ? ['paid', 'partially_refunded', 'refunded'].includes(src.paymentStatus)
      : src.paymentStatus === 'cod_collected';
  return {
    kind: 'order_receipt',
    locale,
    title: l.receiptTitle,
    code: src.code,
    issuedOn: istDateString(src.issuedAt),
    partyName: null,
    customerName: src.customerName,
    vehicle: null,
    lines: src.items.map((i) => ({
      description: locale === 'hi' && i.titleHi ? i.titleHi : i.title,
      qty: i.qty,
      unitPaise: i.unitPaise,
      gstRateBp: null,
      amountPaise: i.totalPaise,
    })),
    totals: signedRows(rows, ['subtotal']),
    totalPaise: src.totalPaise,
    payment: {
      status: paid ? 'paid' : src.paymentMethod === 'cod' ? 'cod' : 'pending',
      method:
        src.paymentMethod === 'cod'
          ? paymentMethodPhrase('cod', locale)
          : paymentMethodPhrase(src.paidMethod, locale),
      paidOn: paid ? istDateString(src.issuedAt) : null,
    },
  };
}
