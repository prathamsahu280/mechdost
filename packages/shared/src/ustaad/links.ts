/**
 * Link rules for Ustaad link posts (spec 23 § 10a, SR-22/23, AT-SSRF-3). Pure: shared by the DTO, the API and the
 * website. A link must be http(s) on the default ports, with no user-info (`https://mechdost.in@evil.com/` is
 * refused at the boundary) and a real host name (no IP literal, no `localhost` / `.local` / `.internal` names); the
 * preview fetcher re-checks every resolved address. The host shown to members is the registrable domain in punycode,
 * parsed with the WHATWG URL parser.
 */

/** Second-level public suffixes we expect from Indian mechanics' links (a small list, not the whole PSL). */
const MULTI_PART_SUFFIXES = new Set([
  'co.in',
  'net.in',
  'org.in',
  'firm.in',
  'gen.in',
  'ind.in',
  'ac.in',
  'edu.in',
  'res.in',
  'gov.in',
  'nic.in',
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'com.au',
  'net.au',
  'org.au',
  'co.nz',
  'co.za',
  'co.jp',
  'com.br',
  'com.sg',
  'com.cn',
]);

export const LINK_URL_MAX = 2000;
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const LOCAL_NAME_RE = /(^|\.)(localhost|local|internal|home|lan|corp|intranet)$/;

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** The normalised URL when it may be posted, else null. */
export function safeLinkUrl(raw: string): string | null {
  if (raw.length > LINK_URL_MAX) return null;
  const u = parse(raw.trim());
  if (!u) return null;
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username !== '' || u.password !== '') return null;
  if (u.port !== '' && u.port !== '80' && u.port !== '443') return null;
  const host = u.hostname.toLowerCase();
  if (host === '' || !host.includes('.') || host.endsWith('.')) return null;
  if (IPV4_RE.test(host) || host.startsWith('[')) return null;
  if (LOCAL_NAME_RE.test(host)) return null;
  if (u.href.length > LINK_URL_MAX) return null;
  return u.href;
}

/** The registrable domain to show ("evil.com" for `https://mechdost.in@evil.com/`), punycode; null when unparsable. */
export function linkDisplayHost(raw: string): string | null {
  const u = parse(raw);
  if (!u) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (host === '' || IPV4_RE.test(host) || host.startsWith('[')) return host || null;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join('.');
  return MULTI_PART_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}
