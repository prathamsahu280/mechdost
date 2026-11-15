import { parseArgs } from 'node:util';
import { z } from 'zod';
import {
  buildMetaTemplates,
  metaTemplateProblems,
  missingTemplates,
  parseMetaTemplateList,
  statusesByKey,
  type MetaTemplateRow,
  type WhatsAppTemplateStatuses,
} from '@mechdost/shared/whatsapp-meta';

/**
 * `pnpm wa:templates` (decision 2026-11-16; Q173): reads the WhatsApp template catalogue, checks it against Meta's
 * rules and, only when told to, creates the templates Meta does not have yet.
 *   (default) --dry-run   print what would be created; no network, no credentials
 *   --status [--save]     read the account's templates and print their approval status; --save stores it for the
 *                         worker's send gate (Admin → Notifications shows it)
 *   --submit --yes        create the missing templates (never edits or deletes an existing one)
 * Credentials come from env by name only; the token is never printed (every output line is scrubbed).
 */
export interface CliDeps {
  fetchImpl: typeof fetch;
  out: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  /** Writes the catalogue statuses to the database (`--status --save`). */
  saveStatuses?: (statuses: WhatsAppTemplateStatuses) => Promise<void>;
}

const Env = z.object({
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().regex(/^\d{5,30}$/),
  WHATSAPP_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v23.0'),
  /** Sending token reused unless a separate management token is set. */
  token: z.string().min(20),
});

const RETRYABLE_CODES = new Set([4, 17, 613, 80008, 130429, 131056]);
const MAX_ATTEMPTS = 4;
const EXISTS_SUBCODES = new Set([2388024]);

interface GraphReply {
  ok: boolean;
  status: number;
  json: unknown;
}

/** `.env.example` ships empty values (`NAME=`); an empty variable counts as unset. */
function filled(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

function errorOf(json: unknown): { code?: number; subcode?: number; message?: string } {
  const e = (json as { error?: { code?: number; error_subcode?: number; message?: string } } | null)?.error;
  return { code: e?.code, subcode: e?.error_subcode, message: e?.message };
}

export async function runWaTemplates(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  deps: CliDeps,
): Promise<number> {
  const secrets = [env.WHATSAPP_MANAGEMENT_TOKEN, env.WHATSAPP_ACCESS_TOKEN].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );
  const say = (line: string) => {
    let safe = line;
    for (const s of secrets) safe = safe.split(s).join('[token]');
    deps.out(safe);
  };

  let values: { 'dry-run'?: boolean; status?: boolean; save?: boolean; submit?: boolean; yes?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        'dry-run': { type: 'boolean' },
        status: { type: 'boolean' },
        save: { type: 'boolean' },
        submit: { type: 'boolean' },
        yes: { type: 'boolean' },
      },
      allowPositionals: false,
    }));
  } catch (error) {
    say(error instanceof Error ? error.message : 'bad arguments');
    return 2;
  }
  const modes = [values['dry-run'], values.status, values.submit].filter(Boolean).length;
  if (modes > 1) {
    say('Pick one mode: --dry-run, --status or --submit.');
    return 2;
  }
  if (values.save && !values.status) {
    say('--save only works with --status.');
    return 2;
  }
  if (values.submit && !values.yes) {
    say('--submit creates templates on your Meta account. Re-run with --yes once you have read the dry run.');
    return 2;
  }

  const wanted = buildMetaTemplates();
  const problems = wanted.flatMap((t) =>
    metaTemplateProblems(t.payload).map((p) => `${t.payload.name}/${t.payload.language}: ${p}`),
  );

  if (!values.status && !values.submit) {
    say('Dry run: nothing is sent to Meta.');
    for (const t of wanted) {
      const { name, language, category, components } = t.payload;
      const body = components.find((c) => c.type === 'BODY');
      const button = components.find((c) => c.type === 'BUTTONS');
      const own = metaTemplateProblems(t.payload);
      say(
        `${own.length === 0 ? 'ok     ' : 'PROBLEM'} ${name}  ${language}  ${category}` +
          (button?.type === 'BUTTONS'
            ? `  button "${button.buttons[0]?.text ?? ''}" -> ${button.buttons[0]?.url ?? ''}`
            : ''),
      );
      if (body?.type === 'BODY') {
        say(`        ${body.text}`);
        say(`        samples: ${(body.example.body_text[0] ?? []).join(', ')}`);
      }
      for (const p of own) say(`        problem: ${p}`);
    }
    say(
      `${String(wanted.length)} template(s) (${String(wanted.length / 2)} names x en, hi); ${String(problems.length)} problem(s).`,
    );
    return problems.length === 0 ? 0 : 1;
  }

  const parsedEnv = Env.safeParse({
    WHATSAPP_BUSINESS_ACCOUNT_ID: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    WHATSAPP_API_VERSION: filled(env.WHATSAPP_API_VERSION),
    token: filled(env.WHATSAPP_MANAGEMENT_TOKEN) ?? filled(env.WHATSAPP_ACCESS_TOKEN),
  });
  if (!parsedEnv.success) {
    say(
      'Set WHATSAPP_BUSINESS_ACCOUNT_ID (digits), a token in WHATSAPP_ACCESS_TOKEN or WHATSAPP_MANAGEMENT_TOKEN ' +
        '(needs whatsapp_business_management) and optionally WHATSAPP_API_VERSION.',
    );
    return 2;
  }
  const cfg = parsedEnv.data;
  const base = `https://graph.facebook.com/${cfg.WHATSAPP_API_VERSION}/${cfg.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`;

  async function graph(method: 'GET' | 'POST', url: string, body?: unknown): Promise<GraphReply> {
    for (let attempt = 1; ; attempt += 1) {
      let reply: GraphReply;
      try {
        const res = await deps.fetchImpl(url, {
          method,
          headers: {
            authorization: `Bearer ${cfg.token}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(15_000),
        });
        reply = { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
      } catch {
        reply = { ok: false, status: 0, json: {} };
      }
      const { code } = errorOf(reply.json);
      const transient =
        reply.status === 0 ||
        reply.status === 429 ||
        reply.status >= 500 ||
        (code !== undefined && RETRYABLE_CODES.has(code));
      if (reply.ok || !transient || attempt >= MAX_ATTEMPTS) return reply;
      await deps.sleep(1000 * 2 ** (attempt - 1));
    }
  }

  async function listAll(): Promise<MetaTemplateRow[] | null> {
    const rows: MetaTemplateRow[] = [];
    let after: string | null = null;
    for (let page = 0; page < 50; page += 1) {
      const query = `fields=name,language,status,category&limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`;
      const reply = await graph('GET', `${base}?${query}`);
      if (!reply.ok) {
        const e = errorOf(reply.json);
        say(
          `Could not read templates: HTTP ${String(reply.status)}, Meta code ${String(e.code ?? '-')}: ${e.message ?? ''}`,
        );
        return null;
      }
      let parsed: ReturnType<typeof parseMetaTemplateList>;
      try {
        parsed = parseMetaTemplateList(reply.json);
      } catch {
        say('Meta returned a template list in an unexpected shape.');
        return null;
      }
      rows.push(...parsed.items);
      if (!parsed.after) return rows;
      after = parsed.after;
    }
    return rows;
  }

  if (values.status) {
    const rows = await listAll();
    if (!rows) return 1;
    say('name                       language  status       category');
    const owned = new Set(wanted.map((t) => `${t.payload.name}/${t.payload.language}`));
    for (const r of rows) {
      say(
        `${r.name.padEnd(26)} ${r.language.padEnd(9)} ${r.status.toLowerCase().padEnd(12)} ${(r.category ?? '').toLowerCase()}${owned.has(`${r.name}/${r.language}`) ? '' : '  (not in catalogue)'}`,
      );
    }
    for (const m of missingTemplates(wanted, rows)) {
      say(
        `${m.payload.name.padEnd(26)} ${m.payload.language.padEnd(9)} missing      (in catalogue, not on Meta)`,
      );
    }
    if (values.save) {
      if (!deps.saveStatuses) {
        say('--save needs DATABASE_URL.');
        return 2;
      }
      await deps.saveStatuses(statusesByKey(rows));
      say('Statuses saved: Admin → Notifications shows them and the worker sends only approved templates.');
    }
    return 0;
  }

  // --submit --yes
  if (problems.length > 0) {
    for (const p of problems) say(`problem: ${p}`);
    say('Nothing submitted: fix the problems above first.');
    return 1;
  }
  const rows = await listAll();
  if (!rows) return 1;
  const todo = missingTemplates(wanted, rows);
  if (todo.length === 0) {
    say('Nothing to submit: every catalogue template already exists on Meta.');
    return 0;
  }
  let failed = 0;
  for (const t of todo) {
    const label = `${t.payload.name}/${t.payload.language}`;
    const reply = await graph('POST', base, t.payload);
    if (reply.ok) {
      const r = reply.json as { id?: string; status?: string; category?: string };
      say(
        `created ${label}: id ${r.id ?? '-'}, status ${(r.status ?? '').toLowerCase()}, category ${(r.category ?? '').toLowerCase()}`,
      );
      continue;
    }
    const e = errorOf(reply.json);
    if (e.subcode !== undefined && EXISTS_SUBCODES.has(e.subcode)) {
      say(`already exists ${label}`);
      continue;
    }
    failed += 1;
    say(
      `FAILED ${label}: HTTP ${String(reply.status)}, Meta code ${String(e.code ?? '-')}/${String(e.subcode ?? '-')}: ${e.message ?? ''}`,
    );
  }
  say(
    `${String(todo.length - failed)} of ${String(todo.length)} submitted. Run --status in a few minutes for the review result.`,
  );
  return failed === 0 ? 0 : 1;
}
