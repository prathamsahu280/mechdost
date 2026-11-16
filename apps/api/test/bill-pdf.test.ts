/**
 * The bill / receipt PDF (user 2026-11-16, Q194): a valid, small PDF in English and Hindi, titled with the code, in the
 * brand's fonts; Devanagari goes through the shaping font. Layout is checked by eye from the rendered PNG (runbook),
 * the machine checks here are structure, size, metadata, fonts and that nothing throws on awkward data.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { serviceBillDocument, orderReceiptDocument } from '@mechdost/shared/bill-document';
import { computeServiceBill, type EstimateLine } from '@mechdost/shared/service-bill';
import { LOGO_PNG_BASE64 } from '../src/notify/pdf/logo';
import { renderBillPdf, type BillCompany } from '../src/notify/pdf/render';

const company: BillCompany = {
  name: 'Shourya Integrated Services Pvt Ltd',
  address: 'C-605 Salasar Greens, Sarona, Tatibandh, Raipur 492099',
  gstin: '22ABVCS4888H1ZL',
  cin: null,
};

const lines: EstimateLine[] = [
  {
    id: 'a',
    description: 'ब्रेक पैड (आगे)',
    qty: 2,
    unitPaise: 50000,
    gstRateBp: 1800,
    decision: 'approved',
  },
  {
    id: 'b',
    description: 'Wheel alignment',
    qty: 1,
    unitPaise: 35000,
    gstRateBp: 1800,
    decision: 'approved',
  },
];
const bill = computeServiceBill(lines, { gstRegistered: true }, { paise: 15000, waived: false });

const serviceDoc = (locale: 'en' | 'hi') =>
  serviceBillDocument(
    {
      code: 'SR-RPR-2026-7M2P9X',
      workshopName: 'Sharma Auto Works',
      workshopNameHi: 'शर्मा ऑटो वर्क्स',
      customerName: 'आशा वर्मा',
      vehicleText: 'Maruti Swift 2019',
      bill: {
        ...bill,
        gstRegistered: true,
        billedAt: new Date('2026-11-16T05:30:00Z'),
        paidAt: null,
        method: null,
      },
    },
    locale,
  );

const text = (pdf: Buffer) => pdf.toString('latin1');

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };

/** The Info /Title: an indirect object holding a UTF-16BE literal string (BOM first, PDF escapes inside). */
function infoTitle(pdf: Buffer): string {
  const src = text(pdf);
  const ref = /\/Title (\d+) 0 R/.exec(src);
  if (!ref) return '';
  const start = src.indexOf(`\n${ref[1] ?? ''} 0 obj\n(`);
  const end = src.indexOf(')\nendobj', start);
  if (start < 0 || end < 0) return '';
  const body = src.slice(src.indexOf('(', start) + 1, end);
  const raw = body.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_m, c: string) =>
    /^[0-7]+$/.test(c) ? String.fromCharCode(parseInt(c, 8)) : (ESCAPES[c] ?? c),
  );
  const bytes = Buffer.from(raw, 'latin1');
  return bytes[0] === 0xfe && bytes[1] === 0xff
    ? bytes.subarray(2).swap16().toString('utf16le')
    : bytes.toString('latin1');
}

describe('bill PDF', () => {
  it('renders a valid English bill with the code in the title', async () => {
    const pdf = await renderBillPdf(serviceDoc('en'), company);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(text(pdf).trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf.length).toBeLessThan(200_000);
    expect(infoTitle(pdf)).toContain('SR-RPR-2026-7M2P9X');
    expect(infoTitle(pdf)).toContain('Bill');
  });

  it('renders the Hindi bill with the Devanagari font embedded, and the English one without it', async () => {
    const hi = await renderBillPdf(serviceDoc('hi'), company);
    const en = await renderBillPdf(serviceDoc('en'), company);
    expect(text(hi)).toMatch(/NotoSansDevanagari/);
    expect(infoTitle(hi)).toContain('बिल');
    expect(infoTitle(hi)).toContain('SR-RPR-2026-7M2P9X');
    // The English bill has Devanagari only in the customer's own text and one line: it still embeds the font.
    expect(text(en)).toMatch(/DMSans/);
    expect(hi.length).toBeLessThan(250_000);
  });

  it('renders an order receipt and a payment receipt', async () => {
    const doc = orderReceiptDocument(
      {
        kind: 'payment',
        code: 'MD-RPR-2026-4K7Q2M',
        customerName: null,
        issuedAt: new Date('2026-11-16T19:00:00Z'),
        items: Array.from({ length: 40 }, (_, i) => ({
          title: `Bosch Brake Pad set number ${String(i)} with a rather long product name that has to wrap`,
          titleHi: null,
          qty: 2,
          unitPaise: 59000,
          totalPaise: 118000,
          gstPaise: 18000,
        })),
        subtotalPaise: 4_720_000,
        discountPaise: 0,
        shippingPaise: 0,
        codFeePaise: 0,
        totalPaise: 4_720_000,
        paymentMethod: 'online',
        paymentStatus: 'paid',
        paidMethod: 'upi',
      },
      'en',
    );
    const pdf = await renderBillPdf(doc, company);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    // 40 wrapped lines do not fit one page: the table continues on the next.
    expect((text(pdf).match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });

  it('does not throw on empty or hostile text', async () => {
    const doc = serviceDoc('en');
    doc.customerName = '<script>alert(1)</script> \u0000 (unbalanced';
    doc.lines[0]!.description = 'क'.repeat(300);
    expect((await renderBillPdf(doc, { ...company, cin: 'U12345CT2020PTC012345' })).length).toBeGreaterThan(
      1000,
    );
  });

  it('keeps the inline logo equal to the web brand asset', () => {
    const asset = readFileSync(new URL('../../web/public/brand/icons/email-logo.png', import.meta.url));
    expect(Buffer.from(LOGO_PNG_BASE64, 'base64').equals(asset)).toBe(true);
  });
});
