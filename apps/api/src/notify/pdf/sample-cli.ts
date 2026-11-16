/**
 * Writes sample bill PDFs (en + hi) for eyeballing: `tsx src/notify/pdf/sample-cli.ts <outDir>`.
 * Used for the Devanagari shaping check in docs/runbooks (render the PDF to PNG, look at the glyphs).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { orderReceiptDocument, serviceBillDocument } from '@mechdost/shared/bill-document';
import { computeServiceBill, type EstimateLine } from '@mechdost/shared/service-bill';
import { renderBillPdf } from './render';

const outDir = process.argv[2] ?? '.';
const company = {
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
  {
    id: 'c',
    description: 'इंजन ऑयल बदलना, क्षत्रिय श्रीमान् कर्मण्य',
    qty: 1,
    unitPaise: 24000,
    gstRateBp: 1800,
    decision: 'approved',
  },
];
const bill = computeServiceBill(lines, { gstRegistered: true }, { paise: 15000, waived: false });
for (const locale of ['en', 'hi'] as const) {
  const svc = serviceBillDocument(
    {
      code: 'SR-RPR-2026-7M2P9X',
      workshopName: 'Sharma Auto Works',
      workshopNameHi: 'शर्मा ऑटो वर्क्स',
      customerName: 'आशा वर्मा',
      vehicleText: 'Maruti Swift 2019',
      bill: { ...bill, gstRegistered: true, billedAt: new Date(), paidAt: new Date(), method: 'upi' },
    },
    locale,
  );
  writeFileSync(join(outDir, `bill-${locale}.pdf`), await renderBillPdf(svc, company));
  const rec = orderReceiptDocument(
    {
      kind: 'order',
      code: 'MD-RPR-2026-4K7Q2M',
      customerName: 'Asha Verma',
      issuedAt: new Date(),
      items: [
        {
          title: 'Bosch Brake Pad',
          titleHi: 'बॉश ब्रेक पैड',
          qty: 2,
          unitPaise: 59000,
          totalPaise: 118000,
          gstPaise: 18000,
        },
        {
          title: 'Engine Oil 5W-30',
          titleHi: null,
          qty: 1,
          unitPaise: 40000,
          totalPaise: 40000,
          gstPaise: 6100,
        },
      ],
      subtotalPaise: 158000,
      discountPaise: 8000,
      shippingPaise: 4900,
      codFeePaise: 0,
      totalPaise: 154900,
      paymentMethod: 'online',
      paymentStatus: 'paid',
      paidMethod: 'upi',
    },
    locale,
  );
  writeFileSync(join(outDir, `receipt-${locale}.pdf`), await renderBillPdf(rec, company));
}
