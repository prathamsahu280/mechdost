/**
 * Bug 2026-11-24 (user video, Compare on a phone, three Tata Green batteries): "when i was scrolling left and right on
 * the compare screen it was hella buggy". Measured on the live page: swiping the sticky name strip left the snapping
 * body behind (names over the wrong columns), then the body snapped to the next column and its position was copied
 * back into the strip mid-swipe (a jump from 84 px to 163 px). Rule now: the strip the shopper touches leads, the
 * other only follows; the body's snap is paused while the strip leads and comes back when the gesture ends.
 */
import { describe, expect, it } from 'vitest';
import { createScrollSync, type SyncEl } from '../src/lib/compare-scroll-sync';

type Handler = () => void;
function fakeEl(): SyncEl & { fire: (type: string) => void; snapType: string } {
  const handlers = new Map<string, Handler[]>();
  const el = {
    scrollLeft: 0,
    snapType: '',
    style: {} as { scrollSnapType: string },
    addEventListener: (type: string, h: Handler) => {
      handlers.set(type, [...(handlers.get(type) ?? []), h]);
    },
    removeEventListener: (type: string, h: Handler) => {
      handlers.set(
        type,
        (handlers.get(type) ?? []).filter((x) => x !== h),
      );
    },
    fire: (type: string) => {
      for (const h of handlers.get(type) ?? []) h();
    },
  };
  Object.defineProperty(el.style, 'scrollSnapType', {
    get: () => el.snapType,
    set: (v: string) => {
      el.snapType = v;
    },
  });
  return el;
}

function setup() {
  const head = fakeEl();
  const body = fakeEl();
  const timers: Handler[] = [];
  const stop = createScrollSync(head, body, {
    settle: (fn) => {
      timers.push(fn);
      return () => {
        const i = timers.indexOf(fn);
        if (i >= 0) timers.splice(i, 1);
      };
    },
  });
  const flush = () => {
    for (const fn of timers.splice(0)) fn();
  };
  return { head, body, stop, flush };
}

describe('compare strips scroll together without fighting', () => {
  it('while the name strip is swiped, the body follows and never pulls the strip back', () => {
    const { head, body } = setup();
    head.fire('touchstart');
    expect(body.snapType).toBe('none');
    for (const x of [20, 60, 84]) {
      head.scrollLeft = x;
      head.fire('scroll');
      expect(body.scrollLeft).toBe(x);
      // The body's own scroll event (an echo, or a snap) must not move the strip the finger is on.
      body.scrollLeft = 163;
      body.fire('scroll');
      expect(head.scrollLeft).toBe(x);
      body.scrollLeft = x;
    }
  });

  it('swiping the body moves the strip, and an echo from the strip does not move the body', () => {
    const { head, body } = setup();
    body.fire('touchstart');
    body.scrollLeft = 120;
    body.fire('scroll');
    expect(head.scrollLeft).toBe(120);
    head.scrollLeft = 7;
    head.fire('scroll');
    expect(body.scrollLeft).toBe(120);
  });

  it('when the gesture settles the body snaps again and the strip lines up with it', () => {
    const { head, body, flush } = setup();
    head.fire('touchstart');
    head.scrollLeft = 90;
    head.fire('scroll');
    head.fire('touchend');
    flush();
    expect(body.snapType).toBe('');
    // The browser snaps the body to the nearest column; with no finger down the body leads.
    body.scrollLeft = 163;
    body.fire('scroll');
    expect(head.scrollLeft).toBe(163);
  });

  it('a wheel or trackpad scroll on the strip leads too, and stop() removes every listener', () => {
    const { head, body, stop } = setup();
    head.fire('wheel');
    head.scrollLeft = 30;
    head.fire('scroll');
    expect(body.scrollLeft).toBe(30);
    stop();
    head.scrollLeft = 99;
    head.fire('scroll');
    expect(body.scrollLeft).toBe(30);
  });
});
