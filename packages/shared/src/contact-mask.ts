/**
 * Masking for the admin people screens (spec 13: contact details masked unless the viewer holds
 * `customers:read_pii`; support sees the last 4 digits) and the search-query classifier. Pure; shared by the API,
 * the repositories and their tests.
 */

const DOT = '•';

export function maskPhone(phone: string | null): string | null {
  if (phone === null) return null;
  return phone.length <= 4 ? DOT.repeat(4) : `${DOT.repeat(6)}${phone.slice(-4)}`;
}

export function maskEmail(email: string | null): string | null {
  if (email === null) return null;
  const at = email.lastIndexOf('@');
  if (at < 1) return DOT.repeat(3);
  return `${email.slice(0, 1)}${DOT.repeat(3)}${email.slice(at)}`;
}

const PHONE_KEYS = /^(phone|contactphone|guestphone|mobile)$/i;
const EMAIL_KEYS = /^(email|contactemail|guestemail)$/i;
const HIDDEN_KEYS = /^(line1|line2|landmark|destination\w*|accountnumber|ifsc|upi\w*|totp\w*)$/i;

/** Audit `before`/`after` JSON with contact details masked and address/bank fields hidden, at any depth. */
export function redactAuditJson(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[hidden]';
  if (Array.isArray(value)) return value.map((v) => redactAuditJson(v, depth + 1));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (HIDDEN_KEYS.test(key)) out[key] = '[hidden]';
    else if (PHONE_KEYS.test(key) && typeof v === 'string') out[key] = maskPhone(v);
    else if (EMAIL_KEYS.test(key) && typeof v === 'string') out[key] = maskEmail(v);
    else out[key] = redactAuditJson(v, depth + 1);
  }
  return out;
}

export type SearchKind = 'code' | 'email' | 'phone' | 'name';

const CODE = /^(MD|SR|REQ)-[A-Z]{3}-\d{4}-[0-9A-Z]{6}(-\d{1,2})?$/; // an order's shop part ends in -1, -2 …

/**
 * What a customer-search box holds: an order/request/ticket code, an email, a phone (last 10 digits) or a name
 * prefix. Null = refuse (too short, too long, or a partial number: a number needs all 10 digits).
 */
export function searchKind(raw: string): { kind: SearchKind; value: string } | null {
  const q = raw.trim();
  if (q.length < 2 || q.length > 100) return null;
  const upper = q.toUpperCase();
  if (CODE.test(upper)) return { kind: 'code', value: upper };
  if (q.includes('@')) return { kind: 'email', value: q.toLowerCase() };
  if (/^[\d\s+()-]+$/.test(q)) {
    const digits = q.replace(/\D/g, '');
    return digits.length >= 10 ? { kind: 'phone', value: digits.slice(-10) } : null;
  }
  return { kind: 'name', value: q.toLowerCase() };
}
