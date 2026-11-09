/**
 * "Fly to cart" motion for add-to-cart (user 2026-11-09). A small chip leaves the button and arcs to the first
 * visible `[data-cart-target]` (the header cart pill); `CART_LANDED_EVENT` fires when it lands so the pill can bump.
 * Pure presentation — the cart is already updated before this runs. Reduced motion: no chip, the event fires at once.
 */
export const CART_LANDED_EVENT = 'mechdost:cart-landed';

function visibleTarget(): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>('[data-cart-target]')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

export function flyToCart(from: HTMLElement, text: string) {
  const landed = () => window.dispatchEvent(new Event(CART_LANDED_EVENT));
  const target = visibleTarget();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!target || reduce || typeof document.body.animate !== 'function') {
    landed();
    return;
  }
  const a = from.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  const start = { x: a.left + a.width / 2, y: a.top + a.height / 2 };
  const end = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  // Peak of the arc: above the higher of the two points, so the chip "throws" up and drops into the cart.
  const lift = Math.min(160, Math.max(60, Math.abs(dx) * 0.25));

  const chip = document.createElement('span');
  chip.className = 'cart-fly';
  chip.setAttribute('aria-hidden', 'true');
  chip.textContent = text;
  chip.style.left = `${String(start.x)}px`;
  chip.style.top = `${String(start.y)}px`;
  document.body.append(chip);

  const at = (t: number, scale: number, opacity = 1) => {
    // Quadratic Bézier from start to end with the control point lifted above the midpoint.
    const cx = dx / 2;
    const cy = Math.min(0, dy) - lift;
    const x = 2 * (1 - t) * t * cx + t * t * dx;
    const y = 2 * (1 - t) * t * cy + t * t * dy;
    return {
      transform: `translate(-50%, -50%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${String(scale)})`,
      opacity,
    };
  };
  const frames = [at(0, 0.4, 0), at(0.08, 1.1), at(0.3, 1), at(0.55, 0.9), at(0.8, 0.7), at(1, 0.35, 0.6)];
  const anim = chip.animate(frames, {
    duration: 720,
    easing: 'cubic-bezier(0.45, 0, 0.55, 1)',
    fill: 'forwards',
  });
  anim.onfinish = () => {
    chip.remove();
    landed();
  };
  anim.oncancel = () => {
    chip.remove();
  };
}
