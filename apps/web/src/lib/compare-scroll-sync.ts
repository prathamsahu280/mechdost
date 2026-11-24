/**
 * Keeps the sticky product strip and the swipeable body of the comparison side by side (spec 02, bug 2026-11-24).
 *
 * The strip the shopper touches (touch, pointer or wheel) leads until the gesture settles; the other only follows, so
 * an echo or a snap of the follower never moves the strip under the finger. While the strip leads, the body's
 * scroll-snap is paused (a snapping body would refuse to follow and then jump to the next column); when the gesture
 * settles the snap comes back, the browser snaps the body to a column, and the strip follows it.
 */
export interface SyncEl {
  scrollLeft: number;
  style: { scrollSnapType: string };
  addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** Runs `fn` once scrolling has gone quiet; returns a cancel function. */
export type Settle = (fn: () => void) => () => void;

const START = ['touchstart', 'pointerdown', 'wheel'] as const;
const END = ['touchend', 'touchcancel', 'pointerup', 'pointercancel'] as const;

/** A quiet period long enough for touch momentum and wheel inertia to end. */
export const SETTLE_MS = 160;

export const browserSettle: Settle = (fn) => {
  const id = setTimeout(fn, SETTLE_MS);
  return () => {
    clearTimeout(id);
  };
};

export function createScrollSync(head: SyncEl, body: SyncEl, opts: { settle?: Settle } = {}): () => void {
  const settle = opts.settle ?? browserSettle;
  let leader: SyncEl | null = null;
  let touching = false;
  let cancelSettle: (() => void) | null = null;

  const release = () => {
    cancelSettle = null;
    if (touching) return;
    leader = null;
    body.style.scrollSnapType = '';
  };
  const scheduleRelease = () => {
    cancelSettle?.();
    cancelSettle = settle(release);
  };
  const lead = (el: SyncEl) => {
    leader = el;
    body.style.scrollSnapType = el === head ? 'none' : '';
  };

  const onStart = (el: SyncEl) => () => {
    touching = true;
    lead(el);
    scheduleRelease();
  };
  const onEnd = () => {
    touching = false;
    scheduleRelease();
  };
  const onScroll = (from: SyncEl, to: SyncEl) => () => {
    // No gesture in progress (keyboard, focus scrolling, the body settling on a column): whoever scrolled leads.
    if (leader === null) lead(from);
    if (leader !== from) return;
    if (Math.abs(to.scrollLeft - from.scrollLeft) > 0.5) to.scrollLeft = from.scrollLeft;
    scheduleRelease();
  };

  const bindings: [SyncEl, string, () => void][] = [];
  for (const el of [head, body]) {
    for (const type of START) bindings.push([el, type, onStart(el)]);
    for (const type of END) bindings.push([el, type, onEnd]);
  }
  bindings.push([head, 'scroll', onScroll(head, body)], [body, 'scroll', onScroll(body, head)]);
  for (const [el, type, fn] of bindings) el.addEventListener(type, fn, { passive: true });

  return () => {
    cancelSettle?.();
    for (const [el, type, fn] of bindings) el.removeEventListener(type, fn);
    body.style.scrollSnapType = '';
  };
}
