import PDFDocument from 'pdfkit';
import { billLabels, billSupportPhone, type BillDocument } from '@mechdost/shared/bill-document';
import { emailDate } from '@mechdost/shared/email-phrases';
import { formatINR } from '@mechdost/shared/money';
import { FONT_SLOTS, fontBytes, type FontSlot } from './fonts';
import { LOGO_ASPECT, LOGO_PNG_BASE64 } from './logo';

/**
 * Renders a `BillDocument` as an A4 PDF (user 2026-11-16, Q194). Brand tokens from `packages/ui/tokens.css`: navy
 * `#101f34` for the header band and text, accent `#ea5728` for the total rule; DM Sans body, Manrope headings, Noto
 * Sans Devanagari for Hindi. No new colours.
 *
 * Mixed scripts: each string is split into runs, Devanagari (and the rupee sign, which only that font carries) in the
 * Devanagari font, everything else in the Latin font; runs are placed one after the other so alignment and wrapping
 * use real widths. Shaping happens inside pdfkit/fontkit per run.
 */
export interface BillCompany {
  name: string;
  address: string;
  gstin: string;
  /** Null until the admin fills it: nothing is printed. */
  cin: string | null;
}

const NAVY = '#101f34';
const ACCENT = '#ea5728';
const PENDING = '#bf3c12';
const MUTED = '#5b6678';
const RULE = '#d9dee6';
const BAND = '#f4f6f9';

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;
const RIGHT = PAGE_W - MARGIN;
const FOOTER_H = 92;
const TOTALS_ROW = 18;

type Weight = 'regular' | 'bold' | 'head';
interface Run {
  text: string;
  dev: boolean;
}

const isDevanagari = (cp: number) =>
  (cp >= 0x0900 && cp <= 0x097f) || cp === 0x200c || cp === 0x200d || cp === 0x20b9;

function runsOf(text: string): Run[] {
  const out: Run[] = [];
  for (const ch of text) {
    const dev = isDevanagari(ch.codePointAt(0) ?? 0);
    const last = out.at(-1);
    if (last?.dev === dev) last.text += ch;
    else out.push({ text: ch, dev });
  }
  return out;
}

const slotFor = (weight: Weight, dev: boolean): FontSlot =>
  dev
    ? weight === 'regular'
      ? 'devRegular'
      : 'devBold'
    : weight === 'regular'
      ? 'sans'
      : weight === 'bold'
        ? 'sansBold'
        : 'head';

/** Characters pdf fonts cannot draw (controls) are replaced; the text stays otherwise as the customer or shop wrote it. */
const clean = (s: string) =>
  Array.from(s, (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code < 32 || code === 127 ? ' ' : ch;
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

class Pen {
  constructor(private readonly doc: PDFKit.PDFDocument) {}

  width(text: string, weight: Weight, size: number): number {
    let w = 0;
    for (const run of runsOf(text)) {
      this.doc.font(slotFor(weight, run.dev)).fontSize(size);
      w += this.doc.widthOfString(run.text);
    }
    return w;
  }

  /** Draw one line; `align: 'right'` treats `x` as the right edge. */
  put(
    text: string,
    x: number,
    y: number,
    o: { weight?: Weight; size?: number; color?: string; align?: 'left' | 'right' } = {},
  ): void {
    const weight = o.weight ?? 'regular';
    const size = o.size ?? 10;
    let cx = o.align === 'right' ? x - this.width(text, weight, size) : x;
    this.doc.fillColor(o.color ?? NAVY);
    for (const run of runsOf(text)) {
      this.doc.font(slotFor(weight, run.dev)).fontSize(size);
      this.doc.text(run.text, cx, y, { lineBreak: false });
      cx += this.doc.widthOfString(run.text);
    }
  }

  /** Greedy word wrap to `maxWidth`; a word longer than the line is cut at the character that overflows. */
  wrap(text: string, maxWidth: number, weight: Weight, size: number): string[] {
    const lines: string[] = [];
    let line = '';
    const push = () => {
      if (line) lines.push(line);
      line = '';
    };
    for (const word of text.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (this.width(candidate, weight, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      push();
      if (this.width(word, weight, size) <= maxWidth) {
        line = word;
        continue;
      }
      for (const ch of word) {
        if (this.width(line + ch, weight, size) > maxWidth) push();
        line += ch;
      }
    }
    push();
    return lines.length > 0 ? lines : [''];
  }
}

export function renderBillPdf(bill: BillDocument, company: BillCompany): Promise<Buffer> {
  const l = billLabels(bill.locale);
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 0, left: MARGIN, right: MARGIN, bottom: 0 },
    autoFirstPage: false,
    lang: bill.locale === 'hi' ? 'hi-IN' : 'en-IN',
    displayTitle: true,
    info: {
      Title: `${bill.title} ${bill.code}`,
      Author: 'MechDost',
      Subject: bill.code,
      Creator: 'MechDost',
    },
  });
  for (const slot of FONT_SLOTS) doc.registerFont(slot, fontBytes(slot));
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);
  });
  const pen = new Pen(doc);
  const logo = Buffer.from(LOGO_PNG_BASE64, 'base64');

  const showGst = bill.lines.some((line) => line.gstRateBp !== null);
  const col = showGst
    ? { descW: 235, qty: 330, rate: 408, gst: 452, amount: RIGHT }
    : { descW: 290, qty: 380, rate: 470, gst: 0, amount: RIGHT };

  const header = () => {
    doc.addPage();
    doc.rect(0, 0, PAGE_W, 76).fill(NAVY);
    const h = 30;
    doc.image(logo, MARGIN, 23, { height: h, width: h * LOGO_ASPECT });
    pen.put(bill.title, RIGHT, 27, { weight: 'head', size: 22, color: '#ffffff', align: 'right' });
  };

  const tableHead = (y: number): number => {
    doc.rect(MARGIN, y, RIGHT - MARGIN, 22).fill(BAND);
    const ty = y + 6;
    pen.put(l.description, MARGIN + 8, ty, { weight: 'bold', size: 9, color: MUTED });
    pen.put(l.qty, col.qty, ty, { weight: 'bold', size: 9, color: MUTED, align: 'right' });
    pen.put(l.rate, col.rate, ty, { weight: 'bold', size: 9, color: MUTED, align: 'right' });
    if (showGst) pen.put(l.gst, col.gst, ty, { weight: 'bold', size: 9, color: MUTED, align: 'right' });
    pen.put(l.amount, col.amount - 8, ty, { weight: 'bold', size: 9, color: MUTED, align: 'right' });
    return y + 22;
  };

  header();

  // Who and what: code and date on the left; customer, workshop and vehicle on the right.
  let y = 96;
  const meta = (x: number, yy: number, label: string, value: string, w: number): number => {
    pen.put(label, x, yy, { size: 8.5, color: MUTED });
    const wrapped = pen.wrap(clean(value), w, 'bold', 10.5).slice(0, 2);
    wrapped.forEach((ln, i) => {
      pen.put(ln, x, yy + 12 + i * 14, { weight: 'bold', size: 10.5 });
    });
    return yy + 12 + wrapped.length * 14 + 8;
  };
  const codeLabel = bill.kind === 'service_bill' ? l.billCode : l.orderCode;
  let leftY = meta(MARGIN, y, codeLabel, bill.code, 230);
  leftY = meta(MARGIN, leftY, l.date, emailDate(bill.issuedOn, bill.locale), 230);
  let rightY = y;
  if (bill.customerName) rightY = meta(310, rightY, l.customer, bill.customerName, 245);
  if (bill.partyName) rightY = meta(310, rightY, l.workshop, bill.partyName, 245);
  if (bill.vehicle) rightY = meta(310, rightY, l.vehicle, bill.vehicle, 245);
  y = Math.max(leftY, rightY) + 6;

  y = tableHead(y);
  for (const line of bill.lines) {
    const desc = pen.wrap(clean(line.description), col.descW, 'regular', 10).slice(0, 4);
    const rowH = desc.length * 14 + 10;
    if (y + rowH > PAGE_H - FOOTER_H - 40) {
      header();
      y = tableHead(96);
    }
    const ty = y + 6;
    desc.forEach((ln, i) => {
      pen.put(ln, MARGIN + 8, ty + i * 14, { size: 10 });
    });
    pen.put(String(line.qty), col.qty, ty, { align: 'right' });
    pen.put(formatINR(line.unitPaise), col.rate, ty, { align: 'right' });
    if (showGst && line.gstRateBp !== null)
      pen.put(`${String(line.gstRateBp / 100)}%`, col.gst, ty, { align: 'right' });
    pen.put(formatINR(line.amountPaise), col.amount - 8, ty, { align: 'right' });
    y += rowH;
    doc.moveTo(MARGIN, y).lineTo(RIGHT, y).lineWidth(0.5).strokeColor(RULE).stroke();
  }

  // Totals, payment status and footer stay together on the last page.
  const need = bill.totals.length * TOTALS_ROW + 40 + 60 + FOOTER_H;
  if (y + need > PAGE_H) {
    header();
    y = 96;
  }
  y += 12;
  for (const row of bill.totals) {
    pen.put(l.totals[row.key], 400, y, { color: MUTED });
    pen.put(formatINR(row.paise), RIGHT - 8, y, { align: 'right' });
    y += TOTALS_ROW;
  }
  y += 2;
  doc.moveTo(380, y).lineTo(RIGHT, y).lineWidth(1.5).strokeColor(ACCENT).stroke();
  y += 8;
  pen.put(l.total, 400, y, { weight: 'bold', size: 12 });
  pen.put(formatINR(bill.totalPaise), RIGHT - 8, y - 1, { weight: 'head', size: 14, align: 'right' });
  y += 34;

  const status = { paid: l.paid, pending: l.pending, cod: l.cod }[bill.payment.status];
  pen.put(status, MARGIN, y, {
    weight: 'bold',
    size: 11,
    color: bill.payment.status === 'paid' ? NAVY : PENDING,
  });
  const detail = [
    bill.payment.method ? `${l.method}: ${bill.payment.method}` : '',
    bill.payment.paidOn ? `${l.paidOn}: ${emailDate(bill.payment.paidOn, bill.locale)}` : '',
  ]
    .filter(Boolean)
    .join('   ');
  if (detail) pen.put(detail, MARGIN, y + 16, { size: 9.5, color: MUTED });

  // Footer: company details (the admin's, from Company details), support line.
  const fy = PAGE_H - FOOTER_H;
  doc.moveTo(MARGIN, fy).lineTo(RIGHT, fy).lineWidth(0.5).strokeColor(RULE).stroke();
  pen.put(clean(company.name), MARGIN, fy + 10, { weight: 'bold', size: 9 });
  const addr = pen.wrap(clean(company.address), RIGHT - MARGIN, 'regular', 8.5).slice(0, 2);
  addr.forEach((ln, i) => {
    pen.put(ln, MARGIN, fy + 23 + i * 11, { size: 8.5, color: MUTED });
  });
  const ids = [company.gstin ? `GSTIN ${company.gstin}` : '', company.cin ? `CIN ${company.cin}` : '']
    .filter(Boolean)
    .join('   ');
  const idY = fy + 23 + addr.length * 11;
  if (ids) pen.put(ids, MARGIN, idY, { size: 8.5, color: MUTED });
  pen.put(`${l.support} ${billSupportPhone}. ${l.copyNote}`, MARGIN, idY + 13, { size: 8.5, color: MUTED });

  doc.end();
  return done;
}
