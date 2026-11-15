import { CANCEL_ATTR, TRIGGER_ATTR, findPanelCancel, isDismissKey, triggerSelector } from './panel-dismiss';

/**
 * The Escape/Cancel behaviour behind `components/site/panel-dismiss.tsx`, loaded on the first panel-opener click or
 * the first Escape so it is not in every page's first load (JS budget, spec 16; 2026-11-16). Escape clicks the open
 * panel's Cancel button (the component's own close logic and analytics event run), and focus returns to the button
 * that opened it. Dialogs and menus with their own Escape handling call `preventDefault` and are left alone.
 */
let lastKey: string | null = null;

export function onDismissKey(e: KeyboardEvent): void {
  if (!isDismissKey(e)) return;
  if (e.target instanceof Element && e.target.closest('dialog[open], [aria-modal="true"]')) return;
  const active = document.activeElement === document.body ? null : document.activeElement;
  const cancel = findPanelCancel(active, document, lastKey);
  if (!(cancel instanceof HTMLElement)) return;
  e.preventDefault();
  cancel.click();
}

function onClick(e: MouseEvent) {
  const opener = e.target instanceof Element ? e.target.closest(`[${TRIGGER_ATTR}]`) : null;
  if (opener) lastKey = opener.getAttribute(TRIGGER_ATTR);
  const cancel = e.target instanceof Element ? e.target.closest(`[${CANCEL_ATTR}]`) : null;
  const key = cancel?.getAttribute(CANCEL_ATTR);
  if (!key) return;
  // Once the panel has unmounted the opener is back in the page; focus it unless focus already sits on something
  // real (the visitor tabbed or clicked elsewhere meanwhile).
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      document.querySelector<HTMLElement>(triggerSelector(key))?.focus();
    });
  });
}

/** Starts the click tracking; `firstKey` is the opener clicked before this module loaded. Returns the cleanup. */
export function installPanelDismiss(firstKey: string | null): () => void {
  if (firstKey !== null) lastKey = firstKey;
  document.addEventListener('click', onClick, true);
  return () => {
    document.removeEventListener('click', onClick, true);
  };
}
