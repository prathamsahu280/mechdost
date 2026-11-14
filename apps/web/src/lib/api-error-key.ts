/**
 * The API's error codes (`lib/admin-api.ts` results) → one of the shared `portal.api_common_err_*` messages, for the
 * admin screens in real sign-in builds (Stream D, 2026-11-14). Screens map their own field codes first and fall
 * back to this, so no API answer ever shows as a blank or a raw code.
 */
export type CommonErrorKey =
  | 'api_common_err_auth'
  | 'api_common_err_2fa'
  | 'api_common_err_verify'
  | 'api_common_err_forbidden'
  | 'api_common_err_rate'
  | 'api_common_err_stale'
  | 'api_common_err_not_found'
  | 'api_common_err_network'
  | 'api_common_err_generic';

const BY_CODE: Record<string, CommonErrorKey> = {
  AUTH_REQUIRED: 'api_common_err_auth',
  HTTP_401: 'api_common_err_auth',
  STAFF_2FA_REQUIRED: 'api_common_err_2fa',
  VERIFICATION_REQUIRED: 'api_common_err_verify',
  FORBIDDEN: 'api_common_err_forbidden',
  SCOPE_REQUIRED: 'api_common_err_forbidden',
  HTTP_403: 'api_common_err_forbidden',
  RATE_LIMITED: 'api_common_err_rate',
  HTTP_429: 'api_common_err_rate',
  CONFLICT: 'api_common_err_stale',
  STALE: 'api_common_err_stale',
  STALE_CONTENT: 'api_common_err_stale',
  STALE_SETTING: 'api_common_err_stale',
  NOT_FOUND: 'api_common_err_not_found',
  HTTP_404: 'api_common_err_not_found',
  NETWORK: 'api_common_err_network',
  UNAVAILABLE: 'api_common_err_network',
};

export function commonErrorKey(code: string): CommonErrorKey {
  const known = BY_CODE[code];
  if (known) return known;
  if (code.startsWith('STALE_')) return 'api_common_err_stale';
  if (/^HTTP_5\d\d$/.test(code)) return 'api_common_err_network';
  return 'api_common_err_generic';
}
