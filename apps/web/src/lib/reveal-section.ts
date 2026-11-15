import { useEffect, useRef } from 'react';

/** True when a section whose top is at `top` (viewport px) is out of view and should be brought in. */
export function needsReveal(top: number, viewportHeight: number): boolean {
  return top < 0 || top >= viewportHeight;
}

/**
 * Portal frames (admin, account): after a side-bar click (`key` = the section), bring the new section's top into view
 * only if it is out of view. The side-bar link turns off Next's own scroll (`PortalNavLink`, `scroll={false}`), which
 * in 2-3 of 10 runs sent the page to the top (user rule 2026-11-16 "no page may feel like a reload"). The section root
 * carries `data-portal-section` and `scroll-mt-28` (clear of the sticky header).
 */
export function useRevealSection(key: string) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const section = document.querySelector<HTMLElement>('[data-portal-section]');
    if (section && needsReveal(section.getBoundingClientRect().top, window.innerHeight))
      section.scrollIntoView({ block: 'start' });
  }, [key]);
}
