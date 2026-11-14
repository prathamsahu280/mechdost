/**
 * Email through Resend (plan 2026-11-13 Task 3b; decision "Email sender addresses"): each template's purpose picks
 * the sender, the reply-to is support@, the outbox dedupe key is the idempotency key, and Resend's answers map to
 * retry / later / permanent. A fake fetch stands in for Resend.
 */
import { describe, expect, it } from 'vitest';
import { enqueueNotification, events, type OutboxRow } from '@mechdost/db/repo';
import { ConfigError, loadConfig } from '../src/config';
import { dispatchOnce } from '../src/notify/dispatcher';
import { createEmailAdapter } from '../src/notify/email';
import { testDb } from './helpers';

const KEY = 're_test_0123456789abcdefghij';

function fakeResend(status = 200, body: unknown = { id: 'email_123' }) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const row = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: '0190-outbox',
  channel: 'email',
  recipientUserId: null,
  recipient: 'asha@example.com',
  templateKey: 'partner_invite',
  locale: 'en',
  payload: { name: 'Asha Verma', expiresOn: '2026-11-20', token: 'tok_0123456789' },
  attempts: 0,
  claimToken: 'claim',
  ...over,
});

const adapter = (fetchImpl: typeof fetch) =>
  createEmailAdapter(
    { apiKey: KEY, domain: 'mechdost.com', webBaseUrl: 'https://mechdost.com' },
    { fetchImpl },
  );

describe('email adapter (Resend)', () => {
  it('sends the invite from updates@ with support@ as reply-to and the dedupe key as idempotency key', async () => {
    const resend = fakeResend();
    expect(await adapter(resend.fetchImpl).send(row())).toEqual({ providerId: 'email_123' });
    const call = resend.calls[0]!;
    expect(call.url).toBe('https://api.resend.com/emails');
    const headers = call.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(headers['idempotency-key']).toBe('outbox-0190-outbox');
    const body = JSON.parse(call.init.body as string) as {
      from: string;
      to: string[];
      reply_to: string;
      subject: string;
      text: string;
      html: string;
    };
    expect(body.from).toBe('MechDost <updates@mechdost.com>');
    expect(body.reply_to).toBe('support@mechdost.com');
    expect(body.to).toEqual(['asha@example.com']);
    expect(body.text).toContain('https://mechdost.com/partners/invite/tok_0123456789');
    expect(body.html).toContain('Asha Verma');
    const hi = fakeResend();
    await adapter(hi.fetchImpl).send(row({ locale: 'hi' }));
    expect((JSON.parse(hi.calls[0]!.init.body as string) as { text: string }).text).toContain(
      'https://mechdost.com/hi/partners/invite/tok_0123456789',
    );
  });

  it('uses the admin text override for the recipient language, keeping the fixed layout and footer', async () => {
    const resend = fakeResend();
    const asked: string[] = [];
    const custom = createEmailAdapter(
      {
        apiKey: KEY,
        domain: 'mechdost.com',
        webBaseUrl: 'https://mechdost.com',
        grievanceContact: 'grievance@mechdost.com',
      },
      {
        fetchImpl: resend.fetchImpl,
        loadOverride: (key, locale) => {
          asked.push(`${key}:${locale}`);
          return Promise.resolve({ subject: 'Hello {name}, welcome', buttonLabel: 'Start now' });
        },
      },
    );
    await custom.send(row());
    expect(asked).toEqual(['partner_invite:en']);
    const body = JSON.parse(resend.calls[0]!.init.body as string) as {
      subject: string;
      text: string;
      html: string;
    };
    expect(body.subject).toBe('Hello Asha Verma, welcome');
    expect(body.text).toContain('Start now: https://mechdost.com/partners/invite/tok_0123456789');
    expect(body.text).toContain('7978776551');
    expect(body.text).toContain('grievance@mechdost.com');
    expect(body.html).toContain('<table');
    // The invite token only builds the link; it is never a placeholder in the text.
    expect(body.html.replace(/href="[^"]*"/g, '')).not.toContain('tok_0123456789');
  });

  it('a test send is marked in the subject; Hindi mail carries the Hindi subject', async () => {
    const resend = fakeResend();
    await adapter(resend.fetchImpl).send(row({ payload: { ...row().payload, test: 'true' } }));
    expect((JSON.parse(resend.calls[0]!.init.body as string) as { subject: string }).subject).toMatch(
      /^\[Test\] /,
    );
    const hi = fakeResend();
    await adapter(hi.fetchImpl).send(row({ locale: 'hi' }));
    expect((JSON.parse(hi.calls[0]!.init.body as string) as { subject: string }).subject).toContain(
      'विक्रेता',
    );
  });

  it('an order email picks the billing sender and escapes values in the HTML', async () => {
    const resend = fakeResend();
    await adapter(resend.fetchImpl).send(
      row({
        templateKey: 'payment_received',
        payload: {
          orderCode: 'MD-RPR-2026-AAAAAA',
          amount: '₹10.00',
          method: 'UPI',
          paymentId: '<img src=x>',
        },
      }),
    );
    const body = JSON.parse(resend.calls[0]!.init.body as string) as { from: string; html: string };
    expect(body.from).toBe('MechDost Billing <billing@mechdost.com>');
    expect(body.html).toContain('&lt;img src=x&gt;');
    expect(body.html).not.toContain('<img');
  });

  it('records email_sent and email_failed server events with the template only, never an address (spec 12)', async () => {
    const db = await testDb();
    const ok = fakeResend();
    const queue = (dedupeKey: string, recipient: string) =>
      enqueueNotification(db, {
        dedupeKey,
        channel: 'email',
        recipient,
        templateKey: 'ticket_received',
        locale: 'hi',
        payload: { ticketCode: 'REQ-RPR-2026-AAAAAA' },
      });
    await queue('events-ok', 'sent-person@example.com');
    expect(await dispatchOnce(db, [adapter(ok.fetchImpl)])).toMatchObject({ sent: 1 });
    await queue('events-bad', 'failed-person@example.com');
    expect(await dispatchOnce(db, [adapter(fakeResend(422, {}).fetchImpl)])).toMatchObject({ failed: 1 });
    const rows = (await db.select().from(events)).filter((r) => r.event.startsWith('email_'));
    const byName = Object.fromEntries(rows.map((r) => [r.event, r.props]));
    expect(byName.email_sent).toEqual({ template: 'ticket_received', locale: 'hi' });
    expect(byName.email_failed).toEqual({ template: 'ticket_received', code: 'resend_422' });
    expect(JSON.stringify(rows)).not.toContain('person@example.com');
  });

  it('maps failures: 429 and 5xx retry, 401 later, 422 permanent; unknown template or recipient is permanent', async () => {
    const send = (status: number) => adapter(fakeResend(status, {}).fetchImpl).send(row());
    await expect(send(429)).rejects.toMatchObject({ failure: 'retry' });
    await expect(send(503)).rejects.toMatchObject({ failure: 'retry' });
    await expect(send(401)).rejects.toMatchObject({ failure: 'later' });
    await expect(send(422)).rejects.toMatchObject({ failure: 'permanent' });
    const ok = fakeResend();
    await expect(adapter(ok.fetchImpl).send(row({ templateKey: 'nope' }))).rejects.toMatchObject({
      failure: 'permanent',
    });
    await expect(adapter(ok.fetchImpl).send(row({ recipient: 'not-an-email' }))).rejects.toMatchObject({
      failure: 'permanent',
    });
    expect(ok.calls).toHaveLength(0);
  });

  it('config: a malformed key is refused; production needs an https website URL', () => {
    const base = { DATABASE_POOL_URL: 'postgres://x' };
    expect(loadConfig({ ...base, RESEND_API_KEY: KEY }).email).toMatchObject({ domain: 'mechdost.com' });
    expect(loadConfig(base).email).toBeNull();
    expect(() => loadConfig({ ...base, RESEND_API_KEY: 'sk_live_x' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, WEB_BASE_URL: 'not a url' })).toThrow(ConfigError);
  });
});
