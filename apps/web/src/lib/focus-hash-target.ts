import { hashTargetId } from './partner-kit';

/**
 * Moves focus to the element a hash link points at (a hash jump scrolls but leaves keyboard focus on the link).
 * The target may render a frame later (a tab change, a lazy section), so it retries for about half a second.
 * A target that is not focusable gets `tabindex="-1"` first. Client only.
 */
export function focusHashTarget(href: string, tries = 30): void {
  const id = hashTargetId(href);
  if (!id) return;
  const attempt = (left: number) => {
    const el = document.getElementById(id);
    if (el) {
      if (!el.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el.tagName)) {
        el.tabIndex = -1;
      }
      el.focus();
    } else if (left > 0) {
      window.requestAnimationFrame(() => {
        attempt(left - 1);
      });
    }
  };
  window.requestAnimationFrame(() => {
    attempt(tries);
  });
}
