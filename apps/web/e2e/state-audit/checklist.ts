/**
 * The written UI state checklist (`docs/qa/ui-state-checklist.md`): rendering it from the cases, merging a
 * regenerated list into an edited file without losing ticks, and ticking it from a Playwright JSON report.
 * Pure functions with `.ts` imports only: the Node scripts and the Vitest suite both call them.
 */
import { describeCase, type AuditCase } from './cases.ts';
import { CHECK_TEXT, type Check } from './model.ts';

export const RESULTS_START = '<!-- run-results:start -->';
export const RESULTS_END = '<!-- run-results:end -->';
const BUGS_HEADING = '## Found bugs';

const ITEM = /^- \[[ x!]\] ([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3}) · /;

/** The checklist line of a case without its tick or result (what the sync test compares). */
export function itemLine(c: AuditCase): string {
  return `- [ ] ${c.id} · ${describeCase(c)} · asserts: ${c.checks.join(' ')}${c.tier === 'core' ? ' · core' : ''}`;
}

/** The base of an item line: unticked and without the ` — result` suffix. */
export function baseOf(line: string): string {
  return line.replace(/^- \[[ x!]\] /, '- [ ] ').replace(/ — .*$/, '');
}

export function idOf(line: string): string | null {
  return ITEM.exec(line)?.[1] ?? null;
}

function countsTable(cases: readonly AuditCase[]): string[] {
  const rows = new Map<
    string,
    { page: string; component: string; strategy: string; n: number; core: number }
  >();
  for (const c of cases) {
    const r = rows.get(c.code) ?? {
      page: c.page,
      component: c.component,
      strategy: c.strategy,
      n: 0,
      core: 0,
    };
    r.n++;
    if (c.tier === 'core') r.core++;
    rows.set(c.code, r);
  }
  const out = [
    '| Id prefix | Page | Component | Strategy | States | In core |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  for (const [code, r] of rows)
    out.push(`| ${code} | ${r.page} | ${r.component} | ${r.strategy} | ${String(r.n)} | ${String(r.core)} |`);
  const core = cases.filter((c) => c.tier === 'core').length;
  out.push(`| **Total** | | | | **${String(cases.length)}** | **${String(core)}** |`);
  return out;
}

const HEADER = `# UI state checklist

Generated from the component state model (\`apps/web/e2e/state-audit/model.ts\`) by the deterministic pairwise
generator (\`apps/web/e2e/state-audit/pairwise.ts\`); background in \`docs/research/ui-testing-gap-2026-11-14.md\`.
Every line is one Playwright test whose title starts with the same id
(\`apps/web/e2e/state-audit/state-audit.audit.ts\`). Do not edit the item lines by hand: change the model and run
\`node apps/web/scripts/state-audit-checklist.mjs\` (ticks and results on unchanged lines are kept; a line whose state
changed starts unticked again). \`apps/web/test/state-audit-checklist.test.ts\` fails when this file and the model
disagree.

## How items get ticked

- \`- [ ]\` not run yet.
- \`- [x] … — 2026-11-15 pass\` passed on that date (P2 notes, if any, follow in brackets).
- \`- [!] … — 2026-11-15 FAIL: <summary> · [screenshot](…)\` failed; the bug goes into **Found bugs** below with
  the id.
- Ticks are written by \`node apps/web/scripts/state-audit-tick.mjs <playwright-json-report>\` after a run
  (runbook: \`docs/runbooks/ui-test-catalogue.md\` § 9). Never tick by hand without running the test.

## Reading a line

\`<id> · <width> · <theme> · <language> · <who> · world=<stored data> · <route> · <component state> · asserts: <checks> · core\`

- **world**: \`empty\` (only the privacy choice stored), \`cart\` (cart + compare list), \`busy\` (orders, service
  requests, quote, ticket, reviews: \`apps/web/e2e/fixtures/demo-world.ts\`).
- **cart** / **compare**: the stored lists (\`CARTS\` / \`COMPARES\` in the model), e.g. \`compare=bat-2\` = two
  batteries in the compare list while the page shows other categories.
- **stress**: data shapes the demo catalogue lacks, applied to the rendered page: \`long-text\` (70+ character
  names), \`long-price\` (₹1,00,000), \`mixed-shape\` (every other card without rating, MRP, saving and badge).
- **interaction** / **action** / **open** / **form**: what is hovered, focused, pressed or clicked before measuring.
- **core**: also runs on every push (CI \`e2e-demo\` job); everything runs nightly.

Assertions (every state, plus a hover and keyboard-focus sweep over the component's controls):

${(Object.entries(CHECK_TEXT) as [Check, string][]).map(([k, v]) => `- \`${k}\`: ${v}.`).join('\n')}

Severity on failure: **P0** a control is covered, overlapped by another control, or out of sync with the stored
state; **P1** a visible layout defect (outside its card, overlap with text, clipped, misaligned, sideways scroll,
no focus ring, page error, axe serious); **P2** polish (targets under 44 px, focus ring partly clipped, axe moderate).
`;

/** The whole checklist for a fresh model (no ticks). */
export function renderChecklist(cases: readonly AuditCase[]): string {
  const out: string[] = [HEADER, '## Counts', '', ...countsTable(cases), ''];
  let page = '';
  let code = '';
  for (const c of cases) {
    if (c.page !== page) {
      page = c.page;
      out.push(`## ${page}`, '');
    }
    if (c.code !== code) {
      code = c.code;
      const n = cases.filter((x) => x.code === code).length;
      out.push(
        `### ${code} — ${c.component}`,
        '',
        `${c.strategy === 'cross' ? 'Full cross of the high-risk dimensions, the rest pairwise' : 'Pairwise (all pairs of values)'}; ${String(n)} states; scope \`${c.scope}\`.`,
        '',
      );
    }
    out.push(itemLine(c));
    const next = cases[cases.indexOf(c) + 1];
    if (next?.code !== code) out.push('');
  }
  out.push(
    BUGS_HEADING,
    '',
    'Triaged from the run results; one row per bug, linked to every checklist id that shows it.',
    '',
    '| Bug | Checklist ids | Severity | Page / component | What fails | Screenshot | Status |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| U1 | SHOP-CARD (compare=bat-2/lub-*), SHOP-ACTION (compare-other) | P1 | Shop / product card | With the compare list holding category A, category-B cards show inline error text and "Add to cart" overflows the card (user 2026-11-14) | — | known, fix in progress (other branch) |',
    '| U2 | SHOP-ACTION (start-new) | P0 | Shop / product card | "Start a new comparison" updates only the clicked card; other cards keep stale pressed state (user 2026-11-14) | — | known, fix in progress |',
    '| U3 | STEP (hover-inc) | P0 | Stepper | The "+" hover background covers the count (user 2026-11-14) | — | known, fix in progress |',
    '| U4 | CMP-TABLE (bat-*, tyr-2, cart=c1/mixed) | P1 | Compare | Columns misaligned when only one product has a "Save" badge or is in the cart; images too tall, touching the header border (user 2026-11-14) | — | known, fix in progress |',
    '',
    '## Run results',
    '',
    RESULTS_START,
    'Not run yet.',
    RESULTS_END,
    '',
  );
  return out.join('\n');
}

/**
 * Regenerate without losing work: item lines whose base is unchanged keep their tick and result; everything from
 * "Found bugs" on (triage, results) is kept from the existing file.
 */
export function mergeChecklist(existing: string, fresh: string): string {
  const kept = new Map<string, string>();
  for (const line of existing.split('\n')) {
    const id = idOf(line);
    if (id) kept.set(id, line);
  }
  const freshLines = fresh.split('\n');
  const merged = freshLines.map((line) => {
    const id = idOf(line);
    if (!id) return line;
    const old = kept.get(id);
    return old && baseOf(old) === line ? old : line;
  });
  const bugsAt = existing.indexOf(BUGS_HEADING);
  const freshBugsAt = merged.indexOf(BUGS_HEADING);
  if (bugsAt < 0 || freshBugsAt < 0) return merged.join('\n');
  return [...merged.slice(0, freshBugsAt), existing.slice(bugsAt).replace(/\n$/, ''), ''].join('\n');
}

export interface TestResult {
  status: 'pass' | 'fail' | 'flaky' | 'skipped';
  /** Findings summary, e.g. "P1 overlap ×2; P2 tap44 ×1" (empty when nothing was found). */
  summary: string;
  /** Screenshot path, already relative to the checklist file. */
  screenshot: string | null;
}

interface JsonAttachment {
  name?: string;
  path?: string;
  body?: string;
  contentType?: string;
}
interface JsonResult {
  status?: string;
  attachments?: JsonAttachment[];
}
interface JsonTest {
  status?: string;
  results?: JsonResult[];
}
interface JsonSpec {
  title?: string;
  tests?: JsonTest[];
}
interface JsonSuite {
  specs?: JsonSpec[];
  suites?: JsonSuite[];
}

/**
 * Results per checklist id from a Playwright JSON report (`--reporter=json`). `toLink` turns an attachment path
 * into the link written in the checklist (relative to the checklist file).
 */
export function resultsFromReport(
  report: unknown,
  toLink: (path: string) => string,
): Map<string, TestResult> {
  const out = new Map<string, TestResult>();
  const visit = (suite: JsonSuite) => {
    for (const spec of suite.specs ?? []) {
      const id = /^([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3})\b/.exec(spec.title ?? '')?.[1];
      if (!id) continue;
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        const last = results[results.length - 1];
        const attachments = results.flatMap((r) => r.attachments ?? []);
        const summaryAtt = [...attachments].reverse().find((a) => a.name === 'state-audit-summary');
        const shot = [...attachments]
          .reverse()
          .find((a) => a.name === 'state-audit-failure' && typeof a.path === 'string');
        const summary = summaryAtt?.body
          ? Buffer.from(summaryAtt.body, 'base64').toString('utf8').trim()
          : '';
        const status: TestResult['status'] =
          test.status === 'skipped' || last?.status === 'skipped'
            ? 'skipped'
            : test.status === 'flaky'
              ? 'flaky'
              : test.status === 'expected'
                ? 'pass'
                : 'fail';
        out.set(id, { status, summary, screenshot: shot?.path ? toLink(shot.path) : null });
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  const suites = (report as { suites?: JsonSuite[] } | null)?.suites ?? [];
  for (const s of suites) visit(s);
  return out;
}

const severityRank = (summary: string) => {
  const m = /P([012])/.exec(summary);
  return m ? Number(m[1]) : 3;
};

/** Ticks the checklist: pass → [x], fail → [!] with summary and screenshot link; rewrites the run results. */
export function tickChecklist(
  markdown: string,
  results: ReadonlyMap<string, TestResult>,
  date: string,
): { markdown: string; passed: number; failed: number; skipped: number; untouched: number } {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let untouched = 0;
  const failures: { id: string; summary: string; shot: string | null }[] = [];
  const lines = markdown.split('\n').map((line) => {
    const id = idOf(line);
    if (!id) return line;
    const r = results.get(id);
    if (!r) {
      untouched++;
      return line;
    }
    const base = baseOf(line).slice('- [ ] '.length);
    if (r.status === 'pass' || r.status === 'flaky') {
      passed++;
      const note = [r.status === 'flaky' ? 'after a retry' : '', r.summary ? `(${r.summary})` : '']
        .filter(Boolean)
        .join(' ');
      return `- [x] ${base} — ${date} pass${note ? ` ${note}` : ''}`;
    }
    if (r.status === 'skipped') {
      skipped++;
      return `- [ ] ${base} — ${date} skipped`;
    }
    failed++;
    failures.push({ id, summary: r.summary, shot: r.screenshot });
    return `- [!] ${base} — ${date} FAIL: ${r.summary || 'see the test output'}${r.screenshot ? ` · [screenshot](${r.screenshot})` : ''}`;
  });
  let text = lines.join('\n');
  const start = text.indexOf(RESULTS_START);
  const end = text.indexOf(RESULTS_END);
  if (start >= 0 && end > start) {
    failures.sort((a, b) => severityRank(a.summary) - severityRank(b.summary) || a.id.localeCompare(b.id));
    const block = [
      RESULTS_START,
      `Last run ${date}: ${String(passed)} passed, ${String(failed)} failed, ${String(skipped)} skipped, ${String(untouched)} not in this run.`,
      '',
      ...(failures.length > 0
        ? [
            '| Id | Findings (worst first) | Screenshot |',
            '| --- | --- | --- |',
            ...failures.map(
              (f) =>
                `| ${f.id} | ${(f.summary || 'see the test output').replace(/\|/g, '/')} | ${f.shot ? `[png](${f.shot})` : '—'} |`,
            ),
          ]
        : ['No failures.']),
      RESULTS_END,
    ].join('\n');
    text = text.slice(0, start) + block + text.slice(end + RESULTS_END.length);
  }
  return { markdown: text, passed, failed, skipped, untouched };
}
