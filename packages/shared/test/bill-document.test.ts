import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BILL_ATTACHMENT_TEMPLATES,
  billFilename,
  billLabels,
  orderReceiptDocument,
  serviceBillDocument,
  type OrderReceiptSource,
  type ServiceBillSource,
} from '../src/bill-document';
import { computeServiceBill, type EstimateLine } from '../src/service-bill';

const billedAt = new Date('2026-11-16T05:30:00Z');

function serviceSource(lines: EstimateLine[], registered: boolean, visit = false): ServiceBillSource {
  const bill = computeServiceBill(
    lines,
    { gstRegistered: registered },
    visit ? { paise: 15000, waived: false } : null,
  );
  return {
    code: 'SR-RPR-2026-7M2P9X',
    workshopName: 'Sharma Auto Works',
    workshopNameHi: 'शर्मा ऑटो वर्क्स',
    customerName: 'Asha Verma',
    vehicleText: 'Maruti Swift 2019',
    bill: { ...bill, gstRegistered: registered, billedAt, paidAt: null, method: null },
  };
}

const line = (over: Partial<EstimateLine> = {}): EstimateLine => ({
  id: 'l1',
  description: 'ब्रेक पैड (आगे)',
  qty: 2,
  unitPaise: 50000,
  gstRateBp: 1800,
  decision: 'approved',
  ...over,
});

describe('service bill document', () => {
  it('is titled Bill (never Tax invoice, Q97) and carries the code, workshop, date in IST and lines', () => {
    const doc = serviceBillDocument(serviceSource([line()], true), 'en');
    expect(doc.title).toBe('Bill');
    expect(doc.code).toBe('SR-RPR-2026-7M2P9X');
    expect(doc.partyName).toBe('Sharma Auto Works');
    expect(doc.issuedOn).toBe('2026-11-16');
    expect(doc.lines).toEqual([
      { description: 'ब्रेक पैड (आगे)', qty: 2, unitPaise: 50000, gstRateBp: 1800, amountPaise: 100000 },
    ]);
    expect(doc.payment.status).toBe('pending');
    expect(JSON.stringify(doc)).not.toMatch(/tax invoice/i);
  });

  it('uses the Hindi workshop name and Hindi labels for hi, and keeps the free text as written', () => {
    const doc = serviceBillDocument(serviceSource([line()], true, true), 'hi');
    expect(doc.partyName).toBe('शर्मा ऑटो वर्क्स');
    expect(doc.title).toBe(billLabels('hi').billTitle);
    expect(doc.lines.at(-1)?.description).toBe(billLabels('hi').visitFee);
    expect(doc.lines[0]?.description).toBe('ब्रेक पैड (आगे)');
  });

  it('marks a paid bill as paid with the method', () => {
    const src = serviceSource([line()], false);
    const doc = serviceBillDocument(
      { ...src, bill: { ...src.bill, paidAt: new Date('2026-11-17T08:00:00Z'), method: 'online' } },
      'en',
    );
    expect(doc.payment).toMatchObject({ status: 'paid', method: 'Online payment', paidOn: '2026-11-17' });
  });

  it('property: the document totals are exactly the stored bill totals, in integer paise', () => {
    const lineArb = fc.record({
      id: fc.uuid(),
      description: fc.string({ minLength: 2, maxLength: 40 }),
      qty: fc.integer({ min: 1, max: 99 }),
      unitPaise: fc.integer({ min: 1, max: 5_000_000 }),
      gstRateBp: fc.constantFrom(0, 500, 1200, 1800, 2800),
      decision: fc.constantFrom('approved', 'declined', 'pending'),
    });
    fc.assert(
      fc.property(
        fc.array(lineArb, { minLength: 1, maxLength: 20 }),
        fc.boolean(),
        fc.boolean(),
        (lines, reg, visit) => {
          const src = serviceSource(lines, reg, visit);
          const doc = serviceBillDocument(src, 'en');
          const t = (key: string) => doc.totals.find((r) => r.key === key)?.paise ?? 0;
          expect(doc.totalPaise).toBe(src.bill.totalPaise);
          expect(t('taxable')).toBe(src.bill.taxablePaise);
          expect(t('cgst')).toBe(src.bill.cgstPaise);
          expect(t('sgst')).toBe(src.bill.sgstPaise);
          expect(t('roundOff')).toBe(src.bill.roundOffPaise);
          expect(doc.lines.reduce((s, l) => s + l.amountPaise, 0)).toBe(src.bill.taxablePaise);
          expect(
            src.bill.taxablePaise + src.bill.cgstPaise + src.bill.sgstPaise + src.bill.roundOffPaise,
          ).toBe(doc.totalPaise);
          for (const r of doc.totals) expect(Number.isInteger(r.paise)).toBe(true);
        },
      ),
    );
  });
});

const order = (over: Partial<OrderReceiptSource> = {}): OrderReceiptSource => ({
  kind: 'order',
  code: 'MD-RPR-2026-4K7Q2M',
  customerName: 'Asha Verma',
  issuedAt: new Date('2026-11-16T19:00:00Z'),
  items: [
    {
      title: 'Bosch Brake Pad',
      titleHi: 'बॉश ब्रेक पैड',
      qty: 2,
      unitPaise: 59000,
      totalPaise: 118000,
      gstPaise: 18000,
    },
    { title: 'Engine Oil 5W-30', titleHi: null, qty: 1, unitPaise: 40000, totalPaise: 40000, gstPaise: 6100 },
  ],
  subtotalPaise: 158000,
  discountPaise: 8000,
  shippingPaise: 4900,
  codFeePaise: 0,
  totalPaise: 154900,
  paymentMethod: 'online',
  paymentStatus: 'paid',
  paidMethod: 'upi',
  ...over,
});

describe('order receipt document', () => {
  it('is titled Receipt; totals are the stored ones; zero rows are left out', () => {
    const doc = orderReceiptDocument(order(), 'en');
    expect(doc.title).toBe('Receipt');
    expect(doc.partyName).toBeNull();
    expect(doc.totalPaise).toBe(154900);
    expect(doc.totals.map((r) => r.key)).toEqual(['subtotal', 'discount', 'delivery', 'gstIncluded']);
    expect(doc.totals.find((r) => r.key === 'discount')?.paise).toBe(-8000);
    expect(doc.totals.find((r) => r.key === 'gstIncluded')?.paise).toBe(24100);
    expect(doc.payment.status).toBe('paid');
  });

  it('shows the Hindi item title when there is one, the English one otherwise', () => {
    const doc = orderReceiptDocument(order(), 'hi');
    expect(doc.lines.map((l) => l.description)).toEqual(['बॉश ब्रेक पैड', 'Engine Oil 5W-30']);
  });

  it('cash on delivery that is collected counts as paid; one that is pending says pay on delivery', () => {
    expect(
      orderReceiptDocument(order({ paymentMethod: 'cod', paymentStatus: 'cod_collected' }), 'en').payment
        .status,
    ).toBe('paid');
    expect(
      orderReceiptDocument(order({ paymentMethod: 'cod', paymentStatus: 'cod_pending' }), 'en').payment
        .status,
    ).toBe('cod');
  });

  it('property: the receipt total equals the stored total and equals subtotal - discount + delivery + cod', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9_000_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (sub, disc, ship, cod) => {
          const d = Math.min(disc, sub);
          const total = sub - d + ship + cod;
          const doc = orderReceiptDocument(
            order({
              subtotalPaise: sub,
              discountPaise: d,
              shippingPaise: ship,
              codFeePaise: cod,
              totalPaise: total,
            }),
            'en',
          );
          expect(doc.totalPaise).toBe(total);
          const sum = doc.totals.filter((r) => r.key !== 'gstIncluded').reduce((s, r) => s + r.paise, 0);
          expect(sum).toBe(total);
        },
      ),
    );
  });
});

describe('attachment rules', () => {
  it('lists exactly the bill and receipt emails', () => {
    expect([...BILL_ATTACHMENT_TEMPLATES].sort()).toEqual(
      ['order_delivered', 'payment_received', 'service_bill_ready', 'service_completed'].sort(),
    );
  });

  it('names the file after the code, safely', () => {
    expect(billFilename('SR-RPR-2026-7M2P9X', 'service_bill')).toBe('MechDost-bill-SR-RPR-2026-7M2P9X.pdf');
    expect(billFilename('MD-RPR-2026-4K7Q2M', 'order_receipt')).toBe(
      'MechDost-receipt-MD-RPR-2026-4K7Q2M.pdf',
    );
    expect(billFilename('../../evil name', 'order_receipt')).toBe('MechDost-receipt-evilname.pdf');
  });
});
