/**
 * The bill / receipt PDF on the bill emails (user 2026-11-16, Q194): only the four listed templates carry one, built at
 * send time from the id in the outbox row, capped in size, and a failure to build never stops the mail or leaks into
 * the logs.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { OutboxRow } from '@mechdost/db/repo';
import { BILL_PDF_MAX_BYTES, BILL_REF_KEY, type ServiceBillSource } from '@mechdost/shared/bill-document';
import { EMPTY_COMPANY } from '@mechdost/shared/company';
import { computeServiceBill, type EstimateLine } from '@mechdost/shared/service-bill';
import { sampleEmailParams } from '@mechdost/shared/email-templates';
import { setLogSink } from '../src/logger';
import { createEmailAdapter } from '../src/notify/email';
import { createBillAttachmentLoader } from '../src/notify/pdf/attachment';

const KEY = 're_test_0123456789abcdefghij';

function fakeResend() {
  const calls: { body: Record<string, unknown> }[] = [];
  const fetchImpl = ((_url: string, init: RequestInit) => {
    calls.push({ body: JSON.parse(init.body as string) as Record<string, unknown> });
    return Promise.resolve(new Response(JSON.stringify({ id: 'email_1' }), { status: 200 }));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const row = (templateKey: string, over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: '0190-outbox',
  channel: 'email',
  recipientUserId: 'user-1',
  recipient: 'asha@example.com',
  templateKey,
  locale: 'en',
  payload: { ...sampleEmailParams(templateKey as never), [BILL_REF_KEY]: 'ref-1' },
  attempts: 0,
  claimToken: 'claim',
  ...over,
});

const pdf = Buffer.from('%PDF-1.4 fake');
const adapterWith = (
  fetchImpl: typeof fetch,
  loadAttachment: (
    r: OutboxRow,
    locale: 'en' | 'hi',
  ) => Promise<{ filename: string; content: Buffer } | null>,
) =>
  createEmailAdapter(
    { apiKey: KEY, domain: 'mechdost.com', webBaseUrl: 'https://mechdost.com' },
    { fetchImpl, loadAttachment },
  );

afterEach(() => {
  setLogSink((line) => process.stdout.write(`${line}\n`));
});

describe('email adapter attachments', () => {
  it.each(['service_bill_ready', 'service_completed', 'order_delivered', 'payment_received'])(
    '%s carries the PDF as a base64 attachment with its file name',
    async (template) => {
      const resend = fakeResend();
      await adapterWith(resend.fetchImpl, () =>
        Promise.resolve({ filename: 'MechDost-bill-X.pdf', content: pdf }),
      ).send(row(template));
      expect(resend.calls[0]?.body.attachments).toEqual([
        { filename: 'MechDost-bill-X.pdf', content: pdf.toString('base64') },
      ]);
    },
  );

  it.each([
    'order_confirmed',
    'order_out_for_delivery',
    'service_ready',
    'refund_processed',
    'partner_invite',
  ])('%s never carries an attachment, and the loader is not even asked', async (template) => {
    const resend = fakeResend();
    let asked = 0;
    await adapterWith(resend.fetchImpl, () => {
      asked += 1;
      return Promise.resolve({ filename: 'x.pdf', content: pdf });
    }).send(row(template));
    expect(asked).toBe(0);
    expect(resend.calls[0]?.body).not.toHaveProperty('attachments');
  });

  it('sends the mail without a PDF when there is none, when it is too big, or when building it failed (and logs no detail)', async () => {
    const lines: string[] = [];
    setLogSink((l) => lines.push(l));
    for (const load of [
      () => Promise.resolve(null),
      () => Promise.resolve({ filename: 'big.pdf', content: Buffer.alloc(BILL_PDF_MAX_BYTES + 1) }),
      () => Promise.reject(new Error('db password hunter2 customer asha@example.com')),
    ]) {
      const resend = fakeResend();
      await adapterWith(resend.fetchImpl, load).send(row('service_bill_ready'));
      expect(resend.calls).toHaveLength(1);
      expect(resend.calls[0]?.body).not.toHaveProperty('attachments');
    }
    const logged = lines.join('\n');
    expect(logged).toContain('email_attachment_skipped');
    expect(logged).not.toContain('hunter2');
    expect(logged).not.toContain('asha@example.com');
    expect(logged).not.toContain(KEY);
  });
});

const lines: EstimateLine[] = [
  {
    id: 'a',
    description: 'ब्रेक पैड (आगे)',
    qty: 1,
    unitPaise: 120000,
    gstRateBp: 1800,
    decision: 'approved',
  },
];
const source = (): ServiceBillSource => ({
  code: 'SR-RPR-2026-7M2P9X',
  workshopName: 'Sharma Auto Works',
  workshopNameHi: null,
  customerName: 'Asha Verma',
  vehicleText: 'Honda Activa 6G',
  bill: {
    ...computeServiceBill(lines, { gstRegistered: true }),
    gstRegistered: true,
    billedAt: new Date('2026-11-16T05:30:00Z'),
    paidAt: null,
    method: null,
  },
});

describe('bill attachment loader', () => {
  const make = (loadSource = () => Promise.resolve({ kind: 'service' as const, source: source() })) =>
    createBillAttachmentLoader({ loadSource, loadCompany: () => Promise.resolve(EMPTY_COMPANY) });

  it('builds a PDF named after the code, in the recipient language', async () => {
    const en = await make()(row('service_bill_ready'), 'en');
    expect(en?.filename).toBe('MechDost-bill-SR-RPR-2026-7M2P9X.pdf');
    expect(en?.content.subarray(0, 5).toString()).toBe('%PDF-');
    const hi = await make()(row('service_bill_ready', { locale: 'hi' }), 'hi');
    expect(hi?.content.toString('latin1')).toMatch(/NotoSansDevanagari/);
  });

  it('asks for the document by id and the row recipient, and gives nothing without an id, a recipient or a document', async () => {
    const asked: unknown[] = [];
    const load = (i: unknown) => {
      asked.push(i);
      return Promise.resolve(null);
    };
    expect(await make(load as never)(row('service_bill_ready'), 'en')).toBeNull();
    expect(asked).toEqual([{ template: 'service_bill_ready', ref: 'ref-1', recipientUserId: 'user-1' }]);
    expect(await make()(row('service_bill_ready', { payload: {} }), 'en')).toBeNull();
    expect(await make()(row('service_bill_ready', { payload: { [BILL_REF_KEY]: 5 } }), 'en')).toBeNull();
    expect(await make()(row('order_confirmed'), 'en')).toBeNull();
  });
});
