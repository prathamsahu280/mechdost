/**
 * Reserved names (SR-4, AT-NAME-1). STUB from workstream A with the final signature: workstream B replaces the body
 * with the NFKC fold + TR39 skeleton check against `ustaad_reserved_names` and throws
 * `ValidationError(..., 'NAME_RESERVED')`. Callers (join, PATCH /ustaad/me) already call it.
 */
import type { Tx } from '../orders';

export async function assertUstaadNameAllowed(_tx: Tx, _displayName: string): Promise<void> {
  // Workstream B: reserved-name check. A ships no refusal.
  await Promise.resolve();
}
