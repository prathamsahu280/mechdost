/**
 * Every panel opened by a button can be closed (bug class "opened panel cannot be closed", user 2026-11-16: the
 * review form had no Cancel). The contract, in markup:
 *   - the opening button carries `data-disclosure-trigger="<key>"`;
 *   - the panel has a visible Cancel/close button carrying `data-panel-cancel="<key>"` (>= 44 px target);
 *   - optionally the panel root carries `data-panel-for="<key>"` when the Cancel button sits outside it (a toggle).
 * `PanelDismiss` (mounted once in the layout) turns Escape into a click on the Cancel button of the panel that holds
 * focus, and after any Cancel click puts focus back on the opening button. No per-component keyboard code.
 */

export const CANCEL_ATTR = 'data-panel-cancel';
export const TRIGGER_ATTR = 'data-disclosure-trigger';
export const PANEL_ATTR = 'data-panel-for';

/** The slice of the DOM the lookup needs, so it can be unit-tested without a browser. */
export interface PanelNode {
  getAttribute(name: string): string | null;
  querySelector(selector: string): PanelNode | null;
  parentElement: PanelNode | null;
}
export interface PanelDocument {
  querySelector(selector: string): PanelNode | null;
  querySelectorAll(selector: string): ArrayLike<PanelNode>;
}

const cancelSelector = `[${CANCEL_ATTR}]:not([disabled])`;

/**
 * The Cancel button for the panel around `active`: walking up from the focused element, the first ancestor that
 * names its key (`data-panel-for`) or contains a Cancel button. With focus outside every panel (the page body),
 * the only Cancel button on the page, if there is exactly one.
 */
export function findPanelCancel(active: PanelNode | null, doc: PanelDocument): PanelNode | null {
  for (let el = active; el; el = el.parentElement) {
    const key = el.getAttribute(PANEL_ATTR);
    if (key) {
      const named = doc.querySelector(`[${CANCEL_ATTR}="${key}"]:not([disabled])`);
      if (named) return named;
    }
    const inside = el.querySelector(cancelSelector);
    if (inside) return inside;
  }
  const all = doc.querySelectorAll(cancelSelector);
  return all.length === 1 ? (all[0] ?? null) : null;
}

/** True for a plain Escape that nothing else has handled (no modifier, not while composing text). */
export function isDismissKey(e: {
  key: string;
  defaultPrevented: boolean;
  isComposing?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): boolean {
  return e.key === 'Escape' && !e.defaultPrevented && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey;
}

/** The selector of the opening button to refocus after the Cancel button with this key was used. */
export function triggerSelector(key: string): string {
  return `[${TRIGGER_ATTR}="${key.replace(/["\\]/g, '\\$&')}"]`;
}
