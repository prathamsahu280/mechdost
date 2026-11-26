/**
 * `pnpm usage:check` (founder 2026-11-26; runbook monitoring.md "Usage & limits"): measure every provider and print
 * one line per metric — value, limit, percent, where the number comes from. Prints only: nothing is stored and no
 * alert is sent. `--record` stores the check and raises alerts exactly like the daily job (trigger `cli`).
 * No key, token or address is ever printed. Reads the environment like the API (root `.env`).
 */
import { createDb } from '@mechdost/db';
import { effectiveUsageLimit, readUsageLimitOverrides } from '@mechdost/db/repo';
import { USAGE_METRICS, USAGE_METRIC_CODES, formatUsageValue, usagePercent } from '@mechdost/shared/usage';
import { ConfigError, loadConfig } from '../config';
import { measureUsage, storeUsageCheck, usageSourcesFromConfig } from '../usage/check';

const record = process.argv.includes('--record');

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (err instanceof ConfigError) {
    process.stderr.write(`Settings are not valid: ${err.issues.join('; ')}\n`);
    process.exit(1);
  }
  throw err;
}

const { db, sql } = createDb(config.databaseUrl, { max: 1, transactionPooler: true });
const sources = usageSourcesFromConfig(config);
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));

try {
  const r = await measureUsage(db, sources);
  const overrides = await readUsageLimitOverrides(db);
  const out: string[] = [];
  out.push(`Usage check ${r.finishedAt.toISOString()} (UTC)`);
  out.push(
    `Providers: ${Object.entries(r.statuses)
      .map(([k, v]) => `${k}=${v}`)
      .join('  ')}`,
  );
  out.push('');
  out.push(`${pad('metric', 34)}${pad('value', 14)}${pad('limit', 14)}${pad('used', 8)}source`);
  const byMetric = new Map(r.measurements.map((m) => [m.metric, m]));
  for (const code of USAGE_METRIC_CODES) {
    const m = byMetric.get(code);
    const def = USAGE_METRICS[code];
    if (!m) {
      out.push(`${pad(code, 34)}${pad('-', 14)}${pad('-', 14)}${pad('-', 8)}not measured`);
      continue;
    }
    const limit = effectiveUsageLimit(code, overrides.get(code)?.limitValue, m.total);
    const pct = usagePercent(m.value, limit);
    out.push(
      `${pad(code, 34)}${pad(formatUsageValue(m.value, def.unit), 14)}${pad(
        limit === null ? 'none' : formatUsageValue(limit, def.unit),
        14,
      )}${pad(pct === null ? '-' : `${String(pct)}%`, 8)}${m.source}`,
    );
  }
  process.stdout.write(`${out.join('\n')}\n`);
  if (record) {
    const stored = await storeUsageCheck(db, r, { trigger: 'cli', actor: { type: 'system' } });
    process.stdout.write(
      `\nStored ${String(stored.stored)} values; ${String(stored.alerts.length)} new alert(s).\n`,
    );
  } else process.stdout.write('\nPrinted only (nothing stored). Add --record to store and alert.\n');
} catch (err) {
  process.stderr.write(`Usage check failed: ${err instanceof Error ? err.name : 'error'}\n`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
