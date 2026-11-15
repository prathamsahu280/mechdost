/**
 * Entry of `pnpm wa:templates` (modes in notify/wa-templates-cli.ts; runbook docs/runbooks/whatsapp-templates.md).
 * Reads credentials from the environment by name only. The database is opened only for `--status --save`.
 */
import { createDb } from '@mechdost/db';
import { saveWhatsAppTemplateStatuses } from '@mechdost/db/repo';
import { runWaTemplates, type CliDeps } from './notify/wa-templates-cli';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const url = process.env.DATABASE_URL;
const handle = argv.includes('--save') && url && !url.includes('<') ? createDb(url, { max: 1 }) : null;

const deps: CliDeps = {
  fetchImpl: fetch,
  out: (line) => process.stdout.write(`${line}\n`),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ...(handle ? { saveStatuses: (statuses) => saveWhatsAppTemplateStatuses(handle.db, statuses) } : {}),
};

try {
  process.exitCode = await runWaTemplates(argv, process.env, deps);
} finally {
  await handle?.sql.end();
}
