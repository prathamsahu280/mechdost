'use client';

import { useEffect } from 'react';
import { CANCEL_ATTR, findPanelCancel, isDismissKey, triggerSelector } from '@/lib/panel-dismiss';

/**
 * Escape closes the open in-page panel (by clicking its Cancel button, so the component's own close logic and its
 * analytics event run), and focus returns to the button that opened it. See `lib/panel-dismiss.ts` for the markup
 * contract. Dialogs and menus with their own Escape handling call `preventDefault` and are left alone.
 */
export function PanelDismiss() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!isDismissKey(e)) return;
      if (e.target instanceof Element && e.target.closest('dialog[open], [aria-modal="true"]')) return;
      const active = document.activeElement === document.body ? null : document.activeElement;
      const cancel = findPanelCancel(active, document);
      if (!(cancel instanceof HTMLElement)) return;
      e.preventDefault();
      cancel.click();
    }
    function onClick(e: MouseEvent) {
      const cancel = e.target instanceof Element ? e.target.closest(`[${CANCEL_ATTR}]`) : null;
      const key = cancel?.getAttribute(CANCEL_ATTR);
      if (!key) return;
      // Once the panel has unmounted the opener is back in the page; focus it unless focus already sits on
      // something real (the visitor tabbed or clicked elsewhere meanwhile).
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const active = document.activeElement;
          if (active && active !== document.body && active.isConnected) return;
          document.querySelector<HTMLElement>(triggerSelector(key))?.focus();
        });
      });
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick, true);
    };
  }, []);
  return null;
}
