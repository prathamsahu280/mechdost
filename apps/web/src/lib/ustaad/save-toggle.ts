import type { UstaadSaveKind } from '@mechdost/shared/ustaad/saved';
import type { ApiResult } from '../orders-api';

/**
 * The shared Save control's toggle (spec 23 § 5 Saved, 2026-11-28): the new state shows at once (optimistic), the API
 * call follows, a refusal rolls the state back and returns the error code for the caller's words. One analytics event
 * per successful toggle (kind and direction only, never the id).
 */
export async function toggleSaved(input: {
  kind: UstaadSaveKind;
  saved: boolean;
  send: (on: boolean) => Promise<ApiResult<{ saved: boolean }>>;
  onState: (saved: boolean) => void;
  track: (event: 'ustaad_item_save_toggled', props: { kind: UstaadSaveKind; saved: boolean }) => void;
}): Promise<{ ok: true } | { ok: false; code: string }> {
  const on = !input.saved;
  input.onState(on);
  const r = await input.send(on);
  if (!r.ok) {
    input.onState(input.saved);
    return { ok: false, code: r.code };
  }
  input.track('ustaad_item_save_toggled', { kind: input.kind, saved: on });
  return { ok: true };
}
