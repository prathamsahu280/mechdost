import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Keyring } from '@mechdost/db/crypto';
import { EXPORT_DATASETS, EXPORT_LINK_TTL_SECONDS, type ExportDataset } from '@mechdost/shared/exports';
import { z } from 'zod';

/**
 * Download links for CSV exports (design 2026-11-15). A link is `base64url(payload).base64url(HMAC)`: the payload
 * names the staff member it was issued to, the dataset, the IST day range and the city, plus an expiry (10 minutes)
 * and a random nonce, so it cannot be guessed, edited or used by someone else. The HMAC key is derived from the data
 * keyring's index key (never the encryption key). The download route still authenticates the caller, compares the
 * user and re-checks the permissions and city scope: a link is a note of what was asked, never a grant of rights.
 */
export interface ExportTokenInput {
  /** The staff user the link was issued to. */
  u: string;
  dataset: ExportDataset;
  from: string;
  to: string;
  /** City code the request named, or null for "every city I may export". */
  city: string | null;
}

const Payload = z
  .object({
    u: z.uuid(),
    dataset: z.enum(EXPORT_DATASETS),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    city: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    exp: z.number().int(),
    n: z.string(),
  })
  .strict();

const key = (keyring: Keyring) => createHmac('sha256', keyring.indexKey).update('export-link-v1').digest();
const mac = (keyring: Keyring, body: string) => createHmac('sha256', key(keyring)).update(body).digest();

export function signExportToken(keyring: Keyring, input: ExportTokenInput, now = Date.now()): string {
  const payload = {
    ...input,
    exp: Math.floor(now / 1000) + EXPORT_LINK_TTL_SECONDS,
    n: randomBytes(9).toString('base64url'),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${mac(keyring, body).toString('base64url')}`;
}

export type ExportTokenResult =
  { ok: true; payload: ExportTokenInput & { exp: number } } | { ok: false; reason: 'invalid' | 'expired' };

export function verifyExportToken(keyring: Keyring, token: string, now = Date.now()): ExportTokenResult {
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return { ok: false, reason: 'invalid' };
  const want = mac(keyring, body);
  const got = Buffer.from(sig, 'base64url');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: 'invalid' };
  let parsed: z.infer<typeof Payload>;
  try {
    parsed = Payload.parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (parsed.exp < Math.floor(now / 1000)) return { ok: false, reason: 'expired' };
  const { u, dataset, from, to, city, exp } = parsed;
  return { ok: true, payload: { u, dataset, from, to, city, exp } };
}
