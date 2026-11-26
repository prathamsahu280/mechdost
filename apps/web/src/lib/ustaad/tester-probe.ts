/**
 * Preview testers (founder 2026-11-27; spec 23 § 3): only the API knows the testers list. During `staff_preview` the
 * web asks the gated `GET /v1/ustaad/me` for a signed-in non-staff viewer and lets the shell render only when the
 * answer proves the API's access gate let the caller through: a membership, or a member-level refusal that only exists
 * behind the gate. The gate's generic 404 (`NOT_FOUND`), any other error and sample (demo) data keep it hidden. The API
 * stays the boundary; this decides only what to draw.
 */
import type { ApiResult } from '../orders-api';

const BEHIND_THE_GATE = new Set(['USTAAD_NOT_MEMBER', 'USTAAD_BANNED']);

export function passedUstaadGate(result: ApiResult<unknown>, sample: boolean): boolean {
  if (sample) return false;
  if (result.ok) return true;
  return BEHIND_THE_GATE.has(result.code);
}
