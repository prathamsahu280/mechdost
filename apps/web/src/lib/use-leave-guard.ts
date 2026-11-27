'use client';

import { useEffect } from 'react';

/**
 * A click on this link leaves the page (another path on this site, opened in the same tab), so unsaved edits would be
 * dropped by a client-side navigation that `beforeunload` never sees (SIM-B14). Same path with another query or hash,
 * new-tab clicks, downloads and other sites are not "leaving" here.
 */
export function leavesPage(
  link: { href: string; target: string; download: boolean },
  here: string,
  modified: boolean,
): boolean {
  if (modified || link.download || (link.target !== '' && link.target !== '_self')) return false;
  let to: URL;
  let from: URL;
  try {
    from = new URL(here);
    to = new URL(link.href, from);
  } catch {
    return false;
  }
  return to.origin === from.origin && to.pathname !== from.pathname;
}

/**
 * While `active`, a click on an in-site link that leaves the page asks first (the browser's confirm, like the
 * `beforeunload` prompt for a full navigation). Cancel keeps the person and their edits on the page.
 */
export function useLeaveGuard(active: boolean, message: string): void {
  useEffect(() => {
    if (!active) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
      if (!(a instanceof HTMLAnchorElement)) return;
      const modified = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
      if (
        !leavesPage(
          { href: a.href, target: a.target, download: a.hasAttribute('download') },
          location.href,
          modified,
        )
      )
        return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('click', onClick, true);
    };
  }, [active, message]);
}
