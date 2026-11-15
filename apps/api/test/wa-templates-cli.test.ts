/**
 * `pnpm wa:templates`: dry run, status and submit against a FAKE Graph API (no network, no real credentials).
 * The token is a made-up string; the tests also prove it never reaches the output.
 */
import { describe, expect, it } from 'vitest';
import { WHATSAPP_TEMPLATES } from '@mechdost/shared/whatsapp';
import { runWaTemplates, type CliDeps } from '../src/notify/wa-templates-cli';

const TOKEN = 'EAAG-fake-management-token-0123456789';
const ENV = {
  WHATSAPP_BUSINESS_ACCOUNT_ID: '112233445566778',
  WHATSAPP_ACCESS_TOKEN: TOKEN,
  WHATSAPP_API_VERSION: 'v23.0',
};
const CATALOGUE_COUNT = Object.keys(WHATSAPP_TEMPLATES).length;

interface Call {
  method: string;
  url: string;
  body: unknown;
  auth: string | null;
}

interface Reply {
  status: number;
  json: unknown;
}

function harness(replies: Reply[] | ((call: Call) => Reply)) {
  const calls: Call[] = [];
  const lines: string[] = [];
  const saved: unknown[] = [];
  let i = 0;
  const fetchImpl = ((url: string, init: RequestInit = {}) => {
    const call: Call = {
      method: init.method ?? 'GET',
      url,
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
      auth: new Headers(init.headers).get('authorization'),
    };
    calls.push(call);
    const r = typeof replies === 'function' ? replies(call) : (replies[i++] ?? { status: 500, json: {} });
    return Promise.resolve(new Response(JSON.stringify(r.json), { status: r.status }));
  }) as typeof fetch;
  const deps: CliDeps = {
    fetchImpl,
    out: (l) => lines.push(l),
    sleep: () => Promise.resolve(),
    saveStatuses: (s) => {
      saved.push(s);
      return Promise.resolve();
    },
  };
  return { calls, lines, saved, deps, text: () => lines.join('\n') };
}

const existing = (rows: { name: string; language: string; status: string }[]): Reply => ({
  status: 200,
  json: { data: rows.map((r, n) => ({ ...r, category: 'UTILITY', id: String(n) })) },
});

describe('dry run (default)', () => {
  it('prints every template in en and hi, calls nothing and needs no credentials', async () => {
    const h = harness([]);
    const code = await runWaTemplates([], {}, h.deps);
    expect(code).toBe(0);
    expect(h.calls).toHaveLength(0);
    expect(h.text()).toContain('order_confirmed');
    expect(h.text()).toContain('hi');
    expect(h.text()).toContain(`${String(CATALOGUE_COUNT * 2)} template`);
    expect(h.text()).toMatch(/dry run/i);
  });
});

describe('--status', () => {
  it('lists Meta statuses, marks missing catalogue templates and never prints the token', async () => {
    const h = harness([
      existing([
        { name: 'order_confirmed', language: 'en', status: 'APPROVED' },
        { name: 'mechdost_otp', language: 'en', status: 'APPROVED' },
      ]),
    ]);
    const code = await runWaTemplates(['--status'], ENV, h.deps);
    expect(code).toBe(0);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.method).toBe('GET');
    expect(h.calls[0]?.url).toContain('/v23.0/112233445566778/message_templates');
    expect(h.calls[0]?.auth).toBe(`Bearer ${TOKEN}`);
    expect(h.text()).toMatch(/order_confirmed\s+en\s+approved/i);
    expect(h.text()).toMatch(/order_confirmed\s+hi\s+missing/i);
    expect(h.text()).not.toContain(TOKEN);
  });

  it('--save stores only the templates the catalogue owns', async () => {
    const h = harness([
      existing([
        { name: 'order_confirmed', language: 'en', status: 'APPROVED' },
        { name: 'mechdost_otp', language: 'en', status: 'APPROVED' },
      ]),
    ]);
    expect(await runWaTemplates(['--status', '--save'], ENV, h.deps)).toBe(0);
    expect(h.saved).toEqual([{ 'order.confirmed': { en: 'approved' } }]);
  });

  it('reads further pages by cursor and never follows the token-bearing next URL', async () => {
    const h = harness((call) =>
      call.url.includes('after=CUR1')
        ? existing([{ name: 'order_confirmed', language: 'hi', status: 'PENDING' }])
        : {
            status: 200,
            json: {
              data: [{ name: 'order_confirmed', language: 'en', status: 'APPROVED' }],
              paging: {
                cursors: { after: 'CUR1' },
                next: 'https://graph.facebook.com/leak?access_token=LEAK',
              },
            },
          },
    );
    expect(await runWaTemplates(['--status', '--save'], ENV, h.deps)).toBe(0);
    expect(h.calls).toHaveLength(2);
    expect(h.calls.every((c) => !c.url.includes('LEAK'))).toBe(true);
    expect(h.saved).toEqual([{ 'order.confirmed': { en: 'approved', hi: 'pending' } }]);
  });

  it('says what is missing when credentials are not set', async () => {
    const h = harness([]);
    expect(await runWaTemplates(['--status'], {}, h.deps)).toBe(2);
    expect(h.text()).toContain('WHATSAPP_BUSINESS_ACCOUNT_ID');
    expect(h.calls).toHaveLength(0);
  });

  it('prefers WHATSAPP_MANAGEMENT_TOKEN over the sending token when set', async () => {
    const h = harness([existing([])]);
    await runWaTemplates(
      ['--status'],
      { ...ENV, WHATSAPP_MANAGEMENT_TOKEN: 'EAAG-management-9999999999' },
      h.deps,
    );
    expect(h.calls[0]?.auth).toBe('Bearer EAAG-management-9999999999');
  });
});

describe('--submit', () => {
  it('refuses without --yes and calls nothing', async () => {
    const h = harness([]);
    expect(await runWaTemplates(['--submit'], ENV, h.deps)).toBe(2);
    expect(h.calls).toHaveLength(0);
    expect(h.text()).toContain('--yes');
  });

  it('refuses to mix modes', async () => {
    const h = harness([]);
    expect(await runWaTemplates(['--submit', '--dry-run', '--yes'], ENV, h.deps)).toBe(2);
    expect(h.calls).toHaveLength(0);
  });

  it('creates only the missing templates, with Meta payloads, and never edits or deletes', async () => {
    const all = Object.values(WHATSAPP_TEMPLATES).map((t) => t.name);
    const have = [{ name: 'order_confirmed', language: 'en', status: 'APPROVED' }];
    const h = harness((call) =>
      call.method === 'GET'
        ? existing(have)
        : { status: 200, json: { id: 'new-id', status: 'PENDING', category: 'UTILITY' } },
    );
    const code = await runWaTemplates(['--submit', '--yes'], ENV, h.deps);
    expect(code).toBe(0);
    const posts = h.calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(CATALOGUE_COUNT * 2 - 1);
    expect(h.calls.every((c) => c.method === 'GET' || c.method === 'POST')).toBe(true);
    expect(posts.every((c) => c.url.endsWith('/112233445566778/message_templates'))).toBe(true);
    expect(
      posts.some(
        (c) =>
          (c.body as { name: string; language: string }).name === 'order_confirmed' &&
          (c.body as { language: string }).language === 'en',
      ),
    ).toBe(false);
    const first = posts[0]?.body as {
      name: string;
      language: string;
      category: string;
      components: { type: string }[];
    };
    expect(all).toContain(first.name);
    expect(first.category).toBe('UTILITY');
    expect(first.components[0]?.type).toBe('BODY');
    expect(h.text()).not.toContain(TOKEN);
  });

  it('does nothing when every template already exists', async () => {
    const rows = Object.values(WHATSAPP_TEMPLATES).flatMap((t) =>
      (['en', 'hi'] as const).map((language) => ({ name: t.name, language, status: 'APPROVED' })),
    );
    const h = harness([existing(rows)]);
    expect(await runWaTemplates(['--submit', '--yes'], ENV, h.deps)).toBe(0);
    expect(h.calls).toHaveLength(1);
    expect(h.text()).toMatch(/nothing to submit/i);
  });

  it('retries a rate limit with backoff, then succeeds', async () => {
    let posts = 0;
    const only = Object.values(WHATSAPP_TEMPLATES).flatMap((t) =>
      (['en', 'hi'] as const).map((language) => ({ name: t.name, language, status: 'APPROVED' })),
    );
    const rows = only.filter((r) => !(r.name === 'order_confirmed' && r.language === 'hi'));
    const sleeps: number[] = [];
    const h = harness((call) => {
      if (call.method === 'GET') return existing(rows);
      posts += 1;
      return posts === 1
        ? { status: 429, json: { error: { code: 80008, message: 'rate limit' } } }
        : { status: 200, json: { id: '9', status: 'PENDING', category: 'UTILITY' } };
    });
    h.deps.sleep = (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    expect(await runWaTemplates(['--submit', '--yes'], ENV, h.deps)).toBe(0);
    expect(posts).toBe(2);
    expect(sleeps).toHaveLength(1);
  });

  it('reports a Meta refusal without the token, continues, and exits non-zero', async () => {
    const rows = Object.values(WHATSAPP_TEMPLATES).flatMap((t) =>
      (['en', 'hi'] as const).map((language) => ({ name: t.name, language, status: 'APPROVED' })),
    );
    const missing = rows.filter((r) => !(r.name === 'order_confirmed'));
    const h = harness((call) =>
      call.method === 'GET'
        ? existing(missing)
        : {
            status: 400,
            json: { error: { code: 100, error_subcode: 2388001, message: `bad token ${TOKEN}` } },
          },
    );
    expect(await runWaTemplates(['--submit', '--yes'], ENV, h.deps)).toBe(1);
    expect(h.calls.filter((c) => c.method === 'POST')).toHaveLength(2);
    expect(h.text()).toContain('100');
    expect(h.text()).not.toContain(TOKEN);
  });

  it('treats "already exists" as done', async () => {
    const rows = Object.values(WHATSAPP_TEMPLATES).flatMap((t) =>
      (['en', 'hi'] as const).map((language) => ({ name: t.name, language, status: 'APPROVED' })),
    );
    const h = harness((call) =>
      call.method === 'GET'
        ? existing(rows.filter((r) => r.name !== 'order_confirmed'))
        : { status: 400, json: { error: { code: 100, error_subcode: 2388024, message: 'exists' } } },
    );
    expect(await runWaTemplates(['--submit', '--yes'], ENV, h.deps)).toBe(0);
    expect(h.text()).toMatch(/already exists/i);
  });
});
