/**
 * Geometry assertions of the UI state audit, measured inside the page (2026-11-14). Presence checks missed every
 * bug the user found that day (an "Add to cart" outside its card, a hover background over the count, columns out
 * of line): these functions measure boxes instead.
 *
 * Each exported function is passed to `page.evaluate`, so it must be self-contained: no imports, no module-level
 * helpers; everything it needs is defined inside it. Types only are shared.
 *
 * Rules (rule id → what fails):
 *   inside   a control or a text line extends outside its nearest card-like container (border, shadow, or a
 *            rounded background; table cells), unless something in between scrolls on that axis
 *   overlap  two controls, two text lines, or a control and a text line intersect (> 2 px each way; text boxes
 *            are trimmed 20 % top and bottom so tall Devanagari line boxes do not count), neither inside the
 *            other; a fixed element over page content is normal, two fixed elements overlapping are not
 *   covered  the topmost element at a control's centre (or a text line's centre) is another control: something
 *            is painted over it (hover backgrounds, pseudo-elements, badges)
 *   clipped  text cut by its own overflow (no ellipsis), an ellipsis on a price or a button label, or a line
 *            partly cut by a non-scrolling ancestor
 *   aligned  cards in one grid row differ in height or their last controls sit at different heights; in a
 *            table row the n-th control (or image) of each cell sits at different heights
 *   tap      a target under 24 × 24 px without 24 px spacing (inline links in sentences are exempt);
 *            under 44 px is reported as P2 (one aggregated finding)
 *   hscroll  the page is wider than the viewport (with the widest offenders)
 *   sync     a compare toggle, stepper or the tray disagrees with the stored lists
 */

export type Severity = 'P0' | 'P1' | 'P2';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Finding {
  rule: string;
  severity: Severity;
  where: string;
  detail: string;
  /** Document coordinates of the offending box (for the failure screenshot overlay). */
  box?: Box;
}

export interface DomAuditOptions {
  /** Component root selector; checks look only inside the matching elements. */
  scope: string;
  rules: readonly string[];
  align: readonly { items: string; row?: string }[];
  /** Subtrees never measured (map canvases, third-party widgets). */
  ignore: string;
  /** When set, only boxes inside the container of the element marked `data-sa-focus` are compared. */
  local: boolean;
  /** Scroll through the scope to test `covered` everywhere (slow); otherwise only what is on screen. */
  scan: boolean;
}

/** The DOM audit. Returns findings; never throws for layout reasons. */
export async function auditDom(opts: DomAuditOptions): Promise<Finding[]> {
  const findings: Finding[] = [];
  const add = (f: Finding) => {
    if (findings.length < 400) findings.push(f);
  };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const has = (r: string) => opts.rules.includes(r);
  const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));

  interface R {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }
  const toBox = (r: R): Box => ({
    x: Math.round(r.left + window.scrollX),
    y: Math.round(r.top + window.scrollY),
    w: Math.round(r.right - r.left),
    h: Math.round(r.bottom - r.top),
  });
  const inter = (a: R, b: R): R => ({
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  });
  const empty = (r: R) => r.right - r.left <= 0.5 || r.bottom - r.top <= 0.5;
  const trim = (r: R, f: number): R => {
    const d = (r.bottom - r.top) * f;
    return { left: r.left, right: r.right, top: r.top + d, bottom: r.bottom - d };
  };

  const describe = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    const label =
      el.getAttribute('aria-label') ??
      el.getAttribute('data-track') ??
      el.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
    const card = el.closest('article, li, [role="cell"], [role="row"], td, section');
    const cardName =
      card && card !== el
        ? (card.querySelector('h1, h2, h3, a[data-track^="product_"]')?.textContent ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 40)
        : '';
    return `${tag}${el.id ? `#${el.id}` : ''}"${label}"${cardName ? ` in "${cardName}"` : ''}`;
  };

  const roots = [...document.querySelectorAll(opts.scope)].filter((el) =>
    el.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
  );
  const ignored = (el: Element) => (opts.ignore ? el.closest(opts.ignore) !== null : false);
  const inScope = (el: Element) => roots.some((r) => r === el || r.contains(el));

  const srOnly = (el: Element): boolean => {
    for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (
        cs.position === 'absolute' &&
        (cs.getPropertyValue('clip') === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(50%)')
      )
        return true;
      const r = n.getBoundingClientRect();
      if (cs.overflow === 'hidden' && r.width <= 1 && r.height <= 1) return true;
    }
    return false;
  };
  const visible = (el: Element) =>
    el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && !srOnly(el);

  const fixedCache = new Map<Element, boolean>();
  const inFixed = (el: Element): boolean => {
    const hit = fixedCache.get(el);
    if (hit !== undefined) return hit;
    let out = false;
    for (let n: Element | null = el; n; n = n.parentElement) {
      const p = getComputedStyle(n).position;
      if (p === 'fixed' || p === 'sticky') {
        out = true;
        break;
      }
    }
    fixedCache.set(el, out);
    return out;
  };
  const fixedRoot = (el: Element): Element | null => {
    let found: Element | null = null;
    for (let n: Element | null = el; n; n = n.parentElement) {
      const p = getComputedStyle(n).position;
      if (p === 'fixed' || p === 'sticky') found = n;
    }
    return found;
  };

  /** Visible part of an element: its box cut by every clipping ancestor. */
  const clipOf = (el: Element, scrollersToo: boolean): R => {
    let r: R = { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 };
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const clipsX = cs.overflowX !== 'visible';
      const clipsY = cs.overflowY !== 'visible';
      const scrolls = /auto|scroll/.test(cs.overflowX) || /auto|scroll/.test(cs.overflowY);
      if ((!clipsX && !clipsY) || (scrolls && !scrollersToo)) continue;
      const b = n.getBoundingClientRect();
      r = inter(r, {
        left: clipsX ? b.left : -1e6,
        right: clipsX ? b.right : 1e6,
        top: clipsY ? b.top : -1e6,
        bottom: clipsY ? b.bottom : 1e6,
      });
      if (cs.position === 'fixed') break;
    }
    return r;
  };

  const CONTROL =
    'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';
  const decorative = (el: Element) => el.closest('[aria-hidden="true"]') !== null;

  // Local mode: compare only inside the container of the hovered/focused control.
  const focusEl = opts.local ? document.querySelector('[data-sa-focus]') : null;

  const boxed = (n: Element): boolean => {
    if (
      n.matches('article, td, th, [role="cell"], [role="columnheader"], dialog, [role="dialog"], [popover]')
    )
      return true;
    const cs = getComputedStyle(n);
    const sides = [
      [cs.borderTopWidth, cs.borderTopColor, cs.borderTopStyle],
      [cs.borderRightWidth, cs.borderRightColor, cs.borderRightStyle],
      [cs.borderBottomWidth, cs.borderBottomColor, cs.borderBottomStyle],
      [cs.borderLeftWidth, cs.borderLeftColor, cs.borderLeftStyle],
    ].filter(
      ([w, c, s]) =>
        parseFloat(w ?? '0') >= 1 && s !== 'none' && !/rgba\([^)]*,\s*0\)|transparent/.test(c ?? ''),
    ).length;
    if (sides >= 3) return true;
    if (cs.boxShadow !== 'none') return true;
    const bg = cs.backgroundColor;
    return parseFloat(cs.borderTopLeftRadius) > 0 && !/rgba\([^)]*,\s*0\)|transparent/.test(bg);
  };
  const containerOf = (el: Element): Element | null => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      if (boxed(n)) return n;
      if (n.matches('[popover], dialog, [role="dialog"], [role="tooltip"]')) return n;
    }
    return null;
  };
  const scrollsBetween = (el: Element, stop: Element): { x: boolean; y: boolean } => {
    const out = { x: false, y: false };
    for (let n = el.parentElement; n && n !== stop.parentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/auto|scroll/.test(cs.overflowX)) out.x = true;
      if (/auto|scroll/.test(cs.overflowY)) out.y = true;
    }
    return out;
  };

  const localRoot = focusEl ? (containerOf(focusEl) ?? focusEl.parentElement ?? focusEl) : null;
  const relevant = (el: Element) =>
    !ignored(el) && (localRoot ? localRoot.contains(el) || el.contains(localRoot) : inScope(el));

  // ── collect boxes ──
  interface Item {
    el: Element;
    kind: 'control' | 'text';
    rect: R;
    fixed: boolean;
    /** Text items: the text node and line index, to re-measure after scrolling. */
    node?: Node;
    line?: number;
  }
  const items: Item[] = [];
  const controls: Element[] = [];
  const searchRoots = localRoot ? [localRoot] : roots;
  for (const root of searchRoots) {
    const list = [...(root.matches(CONTROL) ? [root] : []), ...root.querySelectorAll(CONTROL)];
    for (const el of list) {
      if (!relevant(el) || !visible(el) || decorative(el)) continue;
      if (el.matches('[disabled][type="hidden"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const clip = clipOf(el, true);
      const vis = inter(r, clip);
      if (empty(vis)) continue;
      controls.push(el);
      // An inline control that wraps over lines is measured per line box: its one bounding box also covers the
      // text beside the lines (false overlap, audit 2026-11-15).
      const lines = [...el.getClientRects()];
      if (lines.length > 1 && getComputedStyle(el).display === 'inline') {
        lines.forEach((line, index) => {
          if (line.width < 1 || line.height < 1) return;
          const part = inter(line, clip);
          if (!empty(part)) items.push({ el, kind: 'control', rect: part, fixed: inFixed(el), line: index });
        });
      } else items.push({ el, kind: 'control', rect: vis, fixed: inFixed(el) });
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const owner = node.parentElement;
      if (!owner || !(node.textContent ?? '').trim()) continue;
      if (owner.closest('script, style, noscript, template, select, option, datalist, svg')) continue;
      if (!relevant(owner) || !visible(owner) || decorative(owner)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const clip = clipOf(owner, true);
      [...range.getClientRects()].forEach((line, index) => {
        if (line.width < 2 || line.height < 2) return;
        const vis = inter(line, clip);
        if (empty(vis)) return;
        items.push({ el: owner, kind: 'text', rect: vis, fixed: inFixed(owner), node, line: index });
      });
    }
  }

  // ── present ──
  if (has('present') && roots.length === 0)
    add({
      rule: 'present',
      severity: 'P0',
      where: opts.scope,
      detail: 'component not rendered (scope not found)',
    });

  // ── hscroll ──
  if (has('hscroll') && !opts.local) {
    const over = document.documentElement.scrollWidth - vw;
    if (over > 1) {
      const wide = [...document.body.querySelectorAll('*')]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.right > vw + 1 && r.width > 0 && !inFixed(el) && !empty(inter(r, clipOf(el, true)));
        })
        .filter((el) => !el.parentElement || el.parentElement.getBoundingClientRect().right <= vw + 1)
        .slice(0, 3);
      add({
        rule: 'hscroll',
        severity: 'P1',
        where: 'page',
        detail: `page scrolls sideways by ${String(over)} px; widest: ${wide.map(describe).join(', ') || 'unknown'}`,
        box: wide[0] ? toBox(wide[0].getBoundingClientRect()) : undefined,
      });
    }
  }

  // ── inside ──
  if (has('inside')) {
    const seen = new Set<Element>();
    for (const it of items) {
      if ((it.kind === 'text' || it.line !== undefined) && seen.has(it.el)) continue;
      const c = containerOf(it.el);
      if (!c || c === it.el) continue;
      if (it.fixed !== inFixed(c)) continue;
      const cr = c.getBoundingClientRect();
      const s = scrollsBetween(it.el, c);
      const r = it.kind === 'control' && it.line === undefined ? it.el.getBoundingClientRect() : it.rect;
      const out = {
        left: s.x ? 0 : cr.left - r.left,
        right: s.x ? 0 : r.right - cr.right,
        top: s.y ? 0 : cr.top - r.top,
        bottom: s.y ? 0 : r.bottom - cr.bottom,
      };
      const worst = Math.max(out.left, out.right, out.top, out.bottom);
      if (worst > 1.5) {
        seen.add(it.el);
        add({
          rule: 'inside',
          severity: it.kind === 'control' ? 'P1' : 'P1',
          where: describe(it.el),
          detail: `${it.kind} sticks out of its container ${describe(c)} by ${String(Math.round(worst))} px`,
          box: toBox(r),
        });
      }
    }
  }

  // ── overlap ──
  if (has('overlap')) {
    const cell = 64;
    const grid = new Map<string, number[]>();
    items.forEach((it, i) => {
      for (let gx = Math.floor(it.rect.left / cell); gx <= Math.floor(it.rect.right / cell); gx++)
        for (let gy = Math.floor(it.rect.top / cell); gy <= Math.floor(it.rect.bottom / cell); gy++) {
          const k = `${String(gx)},${String(gy)}`;
          const bucket = grid.get(k);
          if (bucket) bucket.push(i);
          else grid.set(k, [i]);
        }
    });
    const done = new Set<string>();
    const reported = new Set<string>();
    for (const bucket of grid.values())
      for (let x = 0; x < bucket.length; x++)
        for (let y = x + 1; y < bucket.length; y++) {
          const i = bucket[x] ?? 0;
          const j = bucket[y] ?? 0;
          const pk = i < j ? `${String(i)}-${String(j)}` : `${String(j)}-${String(i)}`;
          if (done.has(pk)) continue;
          done.add(pk);
          const a = items[i];
          const b = items[j];
          if (!a || !b || a.el === b.el) continue;
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          if (a.fixed !== b.fixed) continue;
          // By design: a control marked data-inset-control over the field of its own wrapper (rule: insetOverlapAllowed).
          const insetOf = (it: (typeof items)[number], other: (typeof items)[number]) =>
            it.el.hasAttribute('data-inset-control') &&
            !other.el.hasAttribute('data-inset-control') &&
            other.el.matches('input, select, textarea') &&
            it.el.parentElement !== null &&
            it.el.parentElement === other.el.parentElement;
          if (insetOf(a, b) || insetOf(b, a)) continue;
          if (
            a.fixed &&
            b.fixed &&
            fixedRoot(a.el) === fixedRoot(b.el) &&
            a.kind === 'text' &&
            b.kind === 'text'
          )
            continue;
          const ra = a.kind === 'text' ? trim(a.rect, 0.2) : a.rect;
          const rb = b.kind === 'text' ? trim(b.rect, 0.2) : b.rect;
          const o = inter(ra, rb);
          if (o.right - o.left <= 2 || o.bottom - o.top <= 2) continue;
          const key = `${describe(a.el)}|${describe(b.el)}`;
          if (reported.has(key)) continue;
          reported.add(key);
          const severity: Severity = a.kind === 'control' && b.kind === 'control' ? 'P0' : 'P1';
          const both =
            a.fixed && b.fixed && fixedRoot(a.el) !== fixedRoot(b.el) ? ' (two floating elements)' : '';
          add({
            rule: 'overlap',
            severity,
            where: describe(a.el),
            detail: `${a.kind} overlaps ${b.kind} ${describe(b.el)} by ${String(Math.round(o.right - o.left))}×${String(Math.round(o.bottom - o.top))} px${both}`,
            box: toBox(o),
          });
        }
  }

  // ── covered ──
  if (has('covered')) {
    const reported = new Set<Element>();
    // Open modals (aria-modal, dialog[open], an open popover sheet): what lies under one is blocked on purpose.
    const modals = [...document.querySelectorAll('[aria-modal="true"], dialog[open], [popover]:popover-open')]
      .filter((m) => m.checkVisibility({ visibilityProperty: true }))
      .filter((m) => getComputedStyle(m).display !== 'none');
    const behindModal = (el: Element, hit: Element): boolean =>
      modals.some((m) => m.contains(hit) && !m.contains(el));

    // Decorative overlays that ignore the pointer (`pointer-events: none`) are invisible to `elementFromPoint`,
    // so the hit test cannot see them: judge them by paint order and box overlap. An overlay counts when it
    // paints something (an opaque background, an image or its own text) after the item in document order.
    const opaque = (c: string) => {
      const m = /rgba?\(([^)]+)\)/.exec(c);
      if (!m) return false;
      const parts = (m[1] ?? '').split(/[ ,/]+/).filter(Boolean);
      return parts.length < 4 || parseFloat(parts[3] ?? '1') >= 0.5;
    };
    const overlays: { el: Element; rect: R }[] = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (ignored(el) || !visible(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.pointerEvents !== 'none' || cs.position === 'static') continue;
      const paints =
        opaque(cs.backgroundColor) ||
        el.matches('img, svg, canvas, video, picture') ||
        [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim() !== '');
      if (!paints) continue;
      const part = inter(el.getBoundingClientRect(), clipOf(el, true));
      if (!empty(part)) overlays.push({ el, rect: part });
    }
    for (const it of items) {
      if (reported.has(it.el)) continue;
      const mine = it.kind === 'text' ? trim(it.rect, 0.2) : it.rect;
      for (const o of overlays) {
        if (o.el === it.el || o.el.contains(it.el) || it.el.contains(o.el)) continue;
        if (!(it.el.compareDocumentPosition(o.el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        if (inFixed(o.el) !== it.fixed) continue;
        const x = inter(mine, o.rect);
        if (x.right - x.left <= 2 || x.bottom - x.top <= 2) continue;
        reported.add(it.el);
        add({
          rule: 'covered',
          severity: it.kind === 'control' ? 'P0' : 'P1',
          where: describe(it.el),
          detail: `${it.kind} is painted over by ${describe(o.el)} (ignores the pointer, found by box overlap)`,
          box: toBox(x),
        });
        break;
      }
    }
    const now = (it: Item): R | null => {
      if (it.kind === 'control') {
        if (it.line === undefined) return inter(it.el.getBoundingClientRect(), clipOf(it.el, true));
        const part = it.el.getClientRects()[it.line];
        return part ? inter(part, clipOf(it.el, true)) : null;
      }
      if (!it.node || it.line === undefined) return it.rect;
      const range = document.createRange();
      range.selectNodeContents(it.node);
      const line = range.getClientRects()[it.line];
      return line ? inter(line, clipOf(it.el, true)) : null;
    };
    /** What paints over the item's centre right now (null: nothing, or something that is allowed to). */
    const coveredBy = (it: Item): { hit: Element; r: R } | null => {
      const r = now(it);
      if (!r || empty(r)) return null;
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      if (cx < 0 || cy < 0 || cx > vw - 1 || cy > vh - 1) return null;
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || hit === it.el || it.el.contains(hit) || hit.contains(it.el)) return null;
      if (inFixed(hit) && !it.fixed) return null;
      if (behindModal(it.el, hit)) return null;
      const coverControl = hit.closest(CONTROL);
      if (it.kind === 'text' && (!coverControl || coverControl.contains(it.el))) return null;
      if (it.kind === 'control' && it.el.matches('input, select, textarea') && hit.closest('label'))
        return null;
      return { hit: coverControl ?? hit, r };
    };
    const report = (it: Item, by: { hit: Element; r: R }) => {
      reported.add(it.el);
      add({
        rule: 'covered',
        severity: it.kind === 'control' ? 'P0' : 'P1',
        where: describe(it.el),
        detail: `${it.kind} is painted over by ${describe(by.hit)}`,
        box: toBox(by.r),
      });
    };
    // Keyboard focus and a scrolling visitor bring an element to the middle of the screen. The scan steps below
    // and Playwright's own scrolling ignore the page's `scroll-padding-top`, so a sticky item that is under the
    // fixed header only at a scan step is not a defect. Such an item is scrolled to the centre and measured
    // again; only a cover that survives is reported (batch 2c, 2026-11-16, runbook § 9.10).
    const probe = async () => {
      const again: Item[] = [];
      for (const it of items) {
        if (reported.has(it.el)) continue;
        const by = coveredBy(it);
        if (!by) continue;
        if (it.fixed && inFixed(by.hit)) again.push(it);
        else report(it, by);
      }
      if (again.length === 0) return;
      const keep = window.scrollY;
      for (const it of again) {
        if (reported.has(it.el)) continue;
        it.el.scrollIntoView({ block: 'center', inline: 'nearest' });
        await frame();
        const by = coveredBy(it);
        if (by) report(it, by);
      }
      window.scrollTo(0, keep);
      await frame();
    };
    if (opts.scan && !opts.local) {
      const start = window.scrollY;
      const tops = roots.map((r) => r.getBoundingClientRect().top + window.scrollY);
      const bottoms = roots.map((r) => r.getBoundingClientRect().bottom + window.scrollY);
      const from = Math.max(0, Math.min(...tops) - 80);
      const to = Math.max(...bottoms);
      for (let y = from; y < to; y += Math.max(200, Math.floor(vh * 0.7))) {
        window.scrollTo(0, y);
        await frame();
        await probe();
      }
      window.scrollTo(0, start);
      await frame();
    } else await probe();
  }

  // ── clipped ──
  if (has('clipped')) {
    const owners = new Set(items.filter((i) => i.kind === 'text').map((i) => i.el));
    for (const el of owners) {
      const cs = getComputedStyle(el);
      const text = el.textContent.trim();
      const priceOrLabel = /₹|\d/.test(text) || el.closest('button, [role="button"]') !== null;
      const ellipsis = cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none';
      const x = cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1;
      const y =
        cs.overflowY !== 'visible' &&
        cs.whiteSpace !== 'nowrap' &&
        cs.textOverflow !== 'ellipsis' &&
        el.scrollHeight > el.clientHeight + 2;
      if ((x || y) && (!ellipsis || priceOrLabel)) {
        add({
          rule: 'clipped',
          severity: 'P1',
          where: describe(el),
          detail: ellipsis
            ? 'price, code or button label shortened with an ellipsis'
            : `text cut off (${x ? `${String(el.scrollWidth)} > ${String(el.clientWidth)} px wide` : `${String(el.scrollHeight)} > ${String(el.clientHeight)} px tall`})`,
          box: toBox(el.getBoundingClientRect()),
        });
        continue;
      }
      // A non-scrolling ancestor cuts part of a line.
      const clip = clipOf(el, false);
      const range = document.createRange();
      range.selectNodeContents(el);
      for (const line of range.getClientRects()) {
        if (line.width < 2 || line.height < 2) continue;
        const vis = inter(line, clip);
        if (empty(vis)) continue;
        const cut = Math.max(
          vis.left - line.left,
          line.right - vis.right,
          vis.top - line.top,
          line.bottom - vis.bottom,
        );
        if (cut > 2 && cut < Math.max(line.width, line.height) - 1) {
          add({
            rule: 'clipped',
            severity: 'P1',
            where: describe(el),
            detail: `a line is cut by ${String(Math.round(cut))} px by a container that hides overflow`,
            box: toBox(line),
          });
          break;
        }
      }
    }
  }

  // ── tap ──
  if (has('tap') && !opts.local) {
    const small: string[] = [];
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      if (r.width >= 44 && r.height >= 44) continue;
      if (r.width < 24 || r.height < 24) {
        const inline =
          el.tagName === 'A' &&
          getComputedStyle(el).display === 'inline' &&
          (el.parentElement?.textContent.trim().length ?? 0) > el.textContent.trim().length + 3;
        if (inline) continue;
        const cx = (r.left + r.right) / 2;
        const cy = (r.top + r.bottom) / 2;
        const zone = { left: cx - 12, right: cx + 12, top: cy - 12, bottom: cy + 12 };
        const crowded = controls.some((o) => {
          if (o === el || o.contains(el) || el.contains(o)) return false;
          return !empty(inter(zone, o.getBoundingClientRect()));
        });
        if (crowded)
          add({
            rule: 'tap',
            severity: 'P1',
            where: describe(el),
            detail: `target ${String(Math.round(r.width))}×${String(Math.round(r.height))} px, under 24 px with a neighbour inside 24 px`,
            box: toBox(r),
          });
        continue;
      }
      small.push(`${describe(el)} ${String(Math.round(r.width))}×${String(Math.round(r.height))}`);
    }
    if (small.length > 0)
      add({
        rule: 'tap44',
        severity: 'P2',
        where: opts.scope,
        detail: `${String(small.length)} targets under 44 px: ${small.slice(0, 6).join('; ')}`,
      });
  }

  // ── aligned ──
  if (has('aligned') && !opts.local) {
    const spread = (xs: number[]) => (xs.length < 2 ? 0 : Math.max(...xs) - Math.min(...xs));
    const ctrlIn = (el: Element) =>
      [...el.querySelectorAll(CONTROL)].filter((c) => visible(c) && !decorative(c));
    for (const spec of opts.align) {
      if (spec.row) {
        for (const row of document.querySelectorAll(spec.row)) {
          if (!inScope(row) || !visible(row)) continue;
          const cells = [...row.children].filter((c) => c.matches(spec.items) && visible(c));
          if (cells.length < 3) continue; // label column + at least two value columns
          const valueCells = cells.filter((c) => c.querySelector('*') !== null || c.textContent.trim());
          const perCell = valueCells.map(ctrlIn);
          const n = Math.min(...perCell.map((p) => p.length));
          for (let k = 0; k < n; k++) {
            const tops = perCell.map((p) => p[k]?.getBoundingClientRect().top ?? 0);
            if (spread(tops) > 3) {
              const first = perCell[0]?.[k];
              add({
                rule: 'aligned',
                severity: 'P1',
                where: first ? describe(first) : spec.row,
                detail: `control ${String(k + 1)} of each column is at different heights (spread ${String(Math.round(spread(tops)))} px)`,
                box: first ? toBox(first.getBoundingClientRect()) : undefined,
              });
              break;
            }
          }
          const imgs = valueCells.map((c) => c.querySelector('img, svg[role="img"], [data-product-visual]'));
          if (imgs.every((i) => i)) {
            const tops = imgs.map((i) => i?.getBoundingClientRect().top ?? 0);
            if (spread(tops) > 3)
              add({
                rule: 'aligned',
                severity: 'P1',
                where: spec.row,
                detail: `images in one row start at different heights (spread ${String(Math.round(spread(tops)))} px)`,
              });
          }
        }
        continue;
      }
      const all = [...document.querySelectorAll(spec.items)].filter((el) => inScope(el) && visible(el));
      const byParent = new Map<Element, Element[]>();
      for (const el of all) {
        const p = el.parentElement?.parentElement ?? el.parentElement;
        if (!p) continue;
        const list = byParent.get(p);
        if (list) list.push(el);
        else byParent.set(p, [el]);
      }
      for (const group of byParent.values()) {
        const rows: Element[][] = [];
        for (const el of group) {
          const top = el.getBoundingClientRect().top;
          const row = rows.find((r) => Math.abs((r[0]?.getBoundingClientRect().top ?? 0) - top) <= 2);
          if (row) row.push(el);
          else rows.push([el]);
        }
        for (const row of rows) {
          if (row.length < 2) continue;
          const heights = row.map((el) => el.getBoundingClientRect().height);
          if (spread(heights) > 2)
            add({
              rule: 'aligned',
              severity: 'P1',
              where: describe(row[0] ?? document.body),
              detail: `cards in one row differ in height (${heights.map((h) => String(Math.round(h))).join(' / ')} px)`,
              box: row[0] ? toBox(row[0].getBoundingClientRect()) : undefined,
            });
          const lastTops = row
            .map((el) => {
              const cs = ctrlIn(el);
              const last = cs.reduce<Element | null>(
                (m, c) => (!m || c.getBoundingClientRect().bottom > m.getBoundingClientRect().bottom ? c : m),
                null,
              );
              // The foot, not the top: a button that wraps to two lines is taller but still sits on the card foot.
              // A panel around the last control that ends with it (the open give-up form, `p-3`) counts as the
              // foot: same walk as `footBottom`.
              if (!last) return undefined;
              let foot = last.getBoundingClientRect().bottom;
              for (let a = last.parentElement; a && a !== el; a = a.parentElement) {
                const cs = getComputedStyle(a);
                const ab = a.getBoundingClientRect().bottom;
                const inner = foot + parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth);
                if (Math.abs(ab - inner) > 1) break;
                foot = ab;
              }
              return foot;
            })
            .filter((t): t is number => t !== undefined);
          // Inner rows (user report 2026-11-15: prices and "In stock" at different heights while the buttons lined
          // up): every `[data-align=key]` part of the cards in one row starts at the same height.
          const keys = new Set(
            row.flatMap((el) =>
              [...el.querySelectorAll('[data-align]')].map((p) => p.getAttribute('data-align') ?? ''),
            ),
          );
          for (const key of keys) {
            const parts = row.map((el) => el.querySelector(`[data-align="${key}"]`));
            if (!parts.every((p) => p && visible(p))) continue;
            const tops = parts.map((p) => p?.getBoundingClientRect().top ?? 0);
            if (spread(tops) > 3)
              add({
                rule: 'aligned',
                severity: 'P1',
                where: describe(parts[0] ?? row[0] ?? document.body),
                detail: `"${key}" rows in one row of cards start at different heights (spread ${String(Math.round(spread(tops)))} px)`,
                box: parts[0] ? toBox(parts[0].getBoundingClientRect()) : undefined,
              });
          }
          if (lastTops.length === row.length && spread(lastTops) > 3)
            add({
              rule: 'aligned',
              severity: 'P1',
              where: describe(row[0] ?? document.body),
              detail: `action rows in one row of cards are at different heights (spread ${String(Math.round(spread(lastTops)))} px)`,
              box: row[0] ? toBox(row[0].getBoundingClientRect()) : undefined,
            });
        }
      }
    }
  }

  return findings;
}

/**
 * In the page, right before a hover (after the control was scrolled to the middle of the screen): is its centre
 * under an open modal dialog, dialog or popover sheet that does not contain it? Such a control cannot be hovered,
 * and it is not a bug. Checked at hover time because scrolling moves a control under a fixed sheet that was not
 * over it when the sweep chose its controls (audit 2026-11-16: SHOP-POPOVER, API-SVC-PHOTOS).
 */
export function behindOpenLayer(node: Element): boolean {
  const layers = [
    ...document.querySelectorAll('[aria-modal="true"], dialog[open], [popover]:popover-open'),
  ].filter((m) => m.checkVisibility({ visibilityProperty: true }));
  const r = node.getBoundingClientRect();
  const cx = (r.left + r.right) / 2;
  const cy = (r.top + r.bottom) / 2;
  return layers.some((m) => {
    if (m.contains(node)) return false;
    // A modal dialog's ::backdrop covers the whole viewport and belongs to the dialog: nothing outside it is reachable.
    if (m.matches(':modal')) return true;
    const b = m.getBoundingClientRect();
    return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom;
  });
}

/** One ancestor between a card's last control and the card, as `footBottom` reads it. */
export interface FootAncestor {
  bottom: number;
  paddingBottom: number;
  borderBottom: number;
}

/**
 * The foot of a card's action area: the bottom of its last control, or of the outermost panel around it that ends
 * with that control (the padding and border of a panel are part of the foot, not a misalignment). `ancestors` run
 * from the control's parent up to the card's child. Climbing stops at an ancestor with anything after the control.
 * `auditDom` applies the same walk inline (it is serialised into the page and cannot import).
 */
export function footBottom(controlBottom: number, ancestors: readonly FootAncestor[]): number {
  let foot = controlBottom;
  for (const a of ancestors) {
    if (Math.abs(a.bottom - (foot + a.paddingBottom + a.borderBottom)) > 1) break;
    foot = a.bottom;
  }
  return foot;
}

/** What the overlap rule knows about one of two overlapping items (see `insetOverlapAllowed`). */
export interface InsetFacts {
  /** The element carries `data-inset-control` (a toggle drawn inside its own field by design). */
  inset?: boolean;
  /** The element is an input, select or textarea. */
  isField?: boolean;
  /** The element's parent: a toggle and its field share one wrapper. */
  wrapper: object | null;
}

/**
 * The one overlap that is by design: a control marked `data-inset-control` (the "Show password" toggle) over the
 * field in the same wrapper. Anything else (an unmarked control, another wrapper, a non-field, two marked ones)
 * is still an overlap. `auditDom` applies the same rule inline (it is serialised into the page and cannot import).
 */
export function insetOverlapAllowed(a: InsetFacts, b: InsetFacts): boolean {
  const pair = (x: InsetFacts, y: InsetFacts) =>
    x.inset === true &&
    y.isField === true &&
    y.inset !== true &&
    x.wrapper !== null &&
    x.wrapper === y.wrapper;
  return pair(a, b) || pair(b, a);
}

/** Marks up to `max` controls in scope with `data-sa-i`, preferring one of each kind first. Returns the count. */
export function markControls(args: { scope: string; max: number; ignore: string }): number {
  const CONTROL =
    'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="checkbox"], [role="switch"]';
  for (const el of document.querySelectorAll('[data-sa-i]')) el.removeAttribute('data-sa-i');
  const roots = [...document.querySelectorAll(args.scope)];
  // Controls under an open modal cannot be hovered: the harness skips them at hover time (`behindOpenLayer`).
  const all: Element[] = [];
  for (const root of roots)
    for (const el of [...(root.matches(CONTROL) ? [root] : []), ...root.querySelectorAll(CONTROL)]) {
      if (args.ignore && el.closest(args.ignore)) continue;
      if (el.closest('[aria-hidden="true"]') || el.matches(':disabled')) continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      all.push(el);
    }
  const kind = (el: Element) =>
    `${el.tagName}|${el.getAttribute('class') ?? ''}|${el.getAttribute('role') ?? ''}`;
  const seen = new Set<string>();
  const first: Element[] = [];
  const rest: Element[] = [];
  for (const el of all) {
    const k = kind(el);
    if (seen.has(k)) rest.push(el);
    else {
      seen.add(k);
      first.push(el);
    }
  }
  const chosen = [...first, ...rest].slice(0, args.max);
  chosen.forEach((el, i) => {
    el.setAttribute('data-sa-i', String(i));
  });
  return chosen.length;
}

/** Facts about the focused element: ring visible, ring clipped, and a description. */
export function focusFacts(args: { scope: string }): {
  inScope: boolean;
  where: string;
  visible: boolean;
  ringClipped: number;
  box: Box | null;
} {
  const el = document.activeElement;
  const roots = [...document.querySelectorAll(args.scope)];
  if (!el || el === document.body || !roots.some((r) => r === el || r.contains(el)))
    return { inScope: false, where: '', visible: false, ringClipped: 0, box: null };
  const cs = getComputedStyle(el);
  const outline =
    cs.outlineStyle !== 'none' &&
    parseFloat(cs.outlineWidth) >= 1 &&
    !/rgba\([^)]*,\s*0\)|transparent/.test(cs.outlineColor);
  const before = el.getAttribute('data-sa-bs');
  const shadow = cs.boxShadow !== 'none' && cs.boxShadow !== before;
  const r = el.getBoundingClientRect();
  const grow = outline ? parseFloat(cs.outlineOffset) + parseFloat(cs.outlineWidth) : shadow ? 2 : 0;
  const ring = { left: r.left - grow, top: r.top - grow, right: r.right + grow, bottom: r.bottom + grow };
  let clip = { left: -1e6, top: -1e6, right: 1e6, bottom: 1e6 };
  for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
    const s = getComputedStyle(n);
    const b = n.getBoundingClientRect();
    if (s.overflowX !== 'visible')
      clip = { ...clip, left: Math.max(clip.left, b.left), right: Math.min(clip.right, b.right) };
    if (s.overflowY !== 'visible')
      clip = { ...clip, top: Math.max(clip.top, b.top), bottom: Math.min(clip.bottom, b.bottom) };
  }
  const ringClipped = Math.max(
    clip.left - ring.left,
    ring.right - clip.right,
    clip.top - ring.top,
    ring.bottom - clip.bottom,
    0,
  );
  const label = el.getAttribute('aria-label') ?? el.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
  return {
    inScope: true,
    where: `${el.tagName.toLowerCase()}"${label}"`,
    // Chrome stops Tab on the native picker button of a date or time input and draws the ring there; the host
    // input is not :focus-visible at that stop (batch 2c). Any other input without a ring still fails.
    visible:
      (el.matches(':focus-visible') && (outline || shadow)) ||
      (el instanceof HTMLInputElement &&
        ['date', 'time', 'datetime-local', 'month', 'week'].includes(el.type)),
    ringClipped: Math.round(ringClipped),
    box: {
      x: Math.round(r.left + window.scrollX),
      y: Math.round(r.top + window.scrollY),
      w: Math.round(r.width),
      h: Math.round(r.height),
    },
  };
}

/** Stores each control's resting box-shadow so a focus shadow can be told apart from a resting one. */
export function rememberShadows(args: { scope: string }): void {
  for (const root of document.querySelectorAll(args.scope))
    for (const el of root.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]'))
      el.setAttribute('data-sa-bs', getComputedStyle(el).boxShadow);
}

/**
 * Store-sync facts: compare toggles vs `mechdost-compare`, steppers vs `mechdost-cart`, the tray vs the list.
 * A stepper is a box whose first and last children are buttons with a number between them.
 */
export function syncFacts(): string[] {
  const problems: string[] = [];
  const read = (k: string): unknown => {
    try {
      return JSON.parse(window.localStorage.getItem(k) ?? 'null');
    } catch {
      return null;
    }
  };
  const compare = read('mechdost-compare') as { slugs?: string[] } | null;
  const inCompare = new Set(compare?.slugs ?? []);
  const cartRaw = read('mechdost-cart');
  const cart = new Map<string, number>(
    Array.isArray(cartRaw)
      ? (cartRaw as { slug?: string; qty?: number }[])
          .filter((l) => typeof l.slug === 'string' && typeof l.qty === 'number')
          .map((l) => [l.slug ?? '', l.qty ?? 0])
      : [],
  );
  const steppers = (root: Element) =>
    [...root.querySelectorAll('div, [role="group"]')].filter((el) => {
      const kids = [...el.children];
      return (
        kids.length >= 3 &&
        kids[0]?.tagName === 'BUTTON' &&
        kids[kids.length - 1]?.tagName === 'BUTTON' &&
        kids.slice(1, -1).some((k) => /\d/.test(k.textContent))
      );
    });
  const pdp = /\/shop\/([a-z0-9-]+)\/?$/.exec(location.pathname)?.[1];
  const units: { slug: string; el: Element }[] = [];
  for (const card of document.querySelectorAll('main article')) {
    const slug = card.querySelector('a[data-track^="product_"]')?.getAttribute('data-track')?.slice(8);
    if (slug && card.checkVisibility()) units.push({ slug, el: card });
  }
  if (pdp) {
    const box = document.querySelector('main input[data-compare-toggle]')?.closest('section, div.grid, main');
    if (box) units.push({ slug: pdp, el: box });
  }
  for (const u of units) {
    const toggle = [...u.el.querySelectorAll<HTMLInputElement>('input[data-compare-toggle]')].find(
      (b) => !b.closest('article') || u.el.matches('article'),
    );
    if (toggle) {
      const pressed = toggle.checked;
      if (pressed !== inCompare.has(u.slug))
        problems.push(
          `${u.slug}: compare toggle ${pressed ? 'pressed' : 'not pressed'} but the list ${inCompare.has(u.slug) ? 'holds it' : 'does not hold it'}`,
        );
    }
    if (u.el.matches('article') || pdp === u.slug) {
      const s = steppers(u.el).filter((x) => x.checkVisibility());
      const qty = cart.get(u.slug);
      const hasAdd = u.el.querySelector('button') !== null;
      if (qty !== undefined && s.length === 0 && hasAdd && u.el.matches('article'))
        problems.push(`${u.slug}: in the cart (${String(qty)}) but the card shows no stepper`);
      if (qty === undefined && s.length > 0) problems.push(`${u.slug}: stepper shown but not in the cart`);
      if (qty !== undefined && s.length > 0 && !(s[0]?.textContent ?? '').includes(String(qty)))
        problems.push(`${u.slug}: stepper does not show the stored quantity ${String(qty)}`);
    }
  }
  return problems;
}

/** What the page shows of the compare list (read in the page; judged by `compareProblems`). */
export interface CompareFacts {
  onShop: boolean;
  /** Products in the stored compare list. */
  size: number;
  slugs: string[];
  trayShown: boolean;
  trayHref: string;
  /** A visible `[data-compare-hint]` ("added, pick one more") anywhere on the page. */
  hintShown: boolean;
  /** The privacy banner is open on a viewport under 1024 px: by design (2026-11-14) the tray waits for the answer. */
  bannerHidesTray: boolean;
}

/** Pure twin of `bannerHidesTray` for the harness (which knows the width and the case's consent state). */
export function trayHiddenByBanner(a: { consentOpen: boolean; width: number; compare: number }): boolean {
  return a.consentOpen && a.width < 1024 && a.compare >= 2;
}

export function compareFacts(): CompareFacts {
  let slugs: string[];
  try {
    const raw = JSON.parse(window.localStorage.getItem('mechdost-compare') ?? 'null') as {
      slugs?: string[];
    } | null;
    slugs = raw?.slugs ?? [];
  } catch {
    slugs = [];
  }
  const tray = document.querySelector('[data-compare-tray]');
  const hint = document.querySelector('[data-compare-hint]');
  return {
    onShop: location.pathname.includes('/shop'),
    size: slugs.length,
    slugs,
    trayShown: tray?.checkVisibility() ?? false,
    trayHref: tray?.querySelector('a[href*="/compare?p="]')?.getAttribute('href') ?? '',
    hintShown: hint?.checkVisibility({ visibilityProperty: true }) ?? false,
    bannerHidesTray:
      document.documentElement.hasAttribute('data-consent-open') &&
      window.innerWidth < 1024 &&
      !tray?.hasAttribute('data-prompt'),
  };
}

/**
 * The compare rule (decision 2026-11-15, 'UI audit decisions'): the list holds 1 -> no tray, but a visible
 * confirmation (`[data-compare-hint]`) near the control; 2 or more -> the tray, linking every product; empty -> neither.
 * Pure: runs in Node, unit-tested.
 */
export function compareProblems(f: CompareFacts): string[] {
  if (!f.onShop) return [];
  const out: string[] = [];
  if (f.size === 0 && f.trayShown) out.push('tray shown with an empty compare list');
  if (f.size === 1) {
    if (f.trayShown) out.push('tray shown with one product in the compare list (it appears from 2)');
    if (!f.hintShown)
      out.push('compare list holds 1 but no visible confirmation ([data-compare-hint]) is shown');
  }
  if (f.size >= 2) {
    if (!f.trayShown && !f.bannerHidesTray)
      out.push(`compare list holds ${String(f.size)} but no tray is shown`);
    else
      for (const s of f.slugs)
        if (!decodeURIComponent(f.trayHref).includes(s)) out.push(`tray link misses ${s}`);
  }
  return out;
}

/**
 * Data-shape variants the demo catalogue lacks, applied to the rendered DOM before measuring (pseudo-localised
 * stress): long names, six-figure prices, and "every other card has no rating, MRP, saving or badge".
 */
export function applyStress(args: { scope: string; stress: string; locale: string }): number {
  if (args.stress === 'none') return 0;
  const roots = [...document.querySelectorAll(args.scope)];
  let changed = 0;
  const textNodes = (root: Element) => {
    const out: Text[] = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n instanceof Text && n.data.trim()) out.push(n);
    return out;
  };
  const LONG =
    args.locale === 'hi'
      ? 'कैस्ट्रॉल एक्टिव 20W40 दोपहिया वाहनों के लिए एक्टिबॉन्ड अणुओं वाला पूरी तरह सिंथेटिक इंजन ऑयल 900 ml'
      : 'Castrol Activ 20W40 fully synthetic engine oil with Actibond molecules for two-wheelers 900 ml';
  for (const root of roots) {
    if (args.stress === 'long-text') {
      const names = root.querySelectorAll(
        'a[data-track^="product_"], h1, [role="columnheader"] a, main li a[href*="/shop/"], main ul a[href*="/workshops/"]',
      );
      for (const el of names) {
        const t = textNodes(el)[0];
        if (t) {
          t.data = LONG;
          changed++;
        }
      }
    }
    if (args.stress === 'long-price') {
      for (const t of textNodes(root))
        if (/₹\s?[\d,]+/.test(t.data)) {
          const mrp = t.parentElement?.closest('.line-through') !== null;
          t.data = t.data.replace(/₹\s?[\d,]+(\.\d+)?/g, mrp ? '₹1,25,000' : '₹1,00,000');
          changed++;
        }
    }
    if (args.stress === 'mixed-shape') {
      const cards = [...root.querySelectorAll('article')];
      const list = root.matches('article') ? [root, ...cards] : cards;
      list.forEach((card, i) => {
        if (i % 2 === 0) return;
        for (const el of card.querySelectorAll<HTMLElement>(
          'p:has(> [role="img"]), .line-through, .bg-success-bg, .bg-accent-button.rounded-md',
        )) {
          el.style.display = 'none';
          changed++;
        }
      });
    }
  }
  return changed;
}

/** Visible text in scope for the Hindi gate (same rules as e2e/hindi-coverage.spec.ts, limited to the scope). */
export function scopeText(args: { scope: string }): string[] {
  const skip = '[data-user-content], .maplibregl-ctrl-attrib, script, style, noscript, template';
  const foreign = (el: Element) => {
    const declared = el.closest('[lang]');
    return (
      declared !== null &&
      declared !== document.documentElement &&
      !(declared.getAttribute('lang') ?? '').startsWith('hi')
    );
  };
  const out: string[] = [];
  for (const root of document.querySelectorAll(args.scope)) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      const text = node.textContent?.trim();
      if (!el || !text || el.closest(skip) || foreign(el)) continue;
      const select = el.closest('select');
      if (!(select ?? el).checkVisibility({ visibilityProperty: true })) continue;
      out.push(text);
    }
    for (const el of root.querySelectorAll('[aria-label], [placeholder], [title], img[alt]')) {
      if (el.closest(skip) || foreign(el) || !el.checkVisibility({ visibilityProperty: true })) continue;
      for (const attr of ['aria-label', 'placeholder', 'title', 'alt']) {
        const value = el.getAttribute(attr);
        if (value) out.push(value);
      }
    }
  }
  return out;
}

/** Draws outlines over the offending boxes for the failure screenshot. */
export function paintFindings(boxes: Box[]): void {
  document.querySelectorAll('[data-sa-paint]').forEach((n) => {
    n.remove();
  });
  for (const b of boxes.slice(0, 30)) {
    const d = document.createElement('div');
    d.setAttribute('data-sa-paint', '');
    d.style.cssText = `position:absolute;left:${String(b.x - 2)}px;top:${String(b.y - 2)}px;width:${String(b.w + 4)}px;height:${String(b.h + 4)}px;outline:3px solid #e11d48;outline-offset:0;z-index:2147483647;pointer-events:none;`;
    document.body.appendChild(d);
  }
}

/**
 * Marks one part of a quantity stepper with `data-sa-target`: in the card of `slug` (when given) or the first
 * stepper in scope. A stepper is a box whose first and last children are buttons with a number between them.
 */
export function markStepper(args: {
  scope: string;
  slug: string | null;
  part: 'dec' | 'inc' | 'count';
}): boolean {
  for (const el of document.querySelectorAll('[data-sa-target]')) el.removeAttribute('data-sa-target');
  const roots = [...document.querySelectorAll(args.scope)];
  const slug = args.slug;
  const within = slug
    ? roots.flatMap((r) =>
        [...r.querySelectorAll('article')].filter(
          (a) => a.querySelector(`a[data-track="product_${slug}"]`) !== null,
        ),
      )
    : roots;
  for (const root of within) {
    // The root itself can be the stepper (the cart's `[role="group"]`).
    const stepper = [root, ...root.querySelectorAll('div, [role="group"]')].find((el) => {
      const kids = [...el.children];
      return (
        kids.length >= 3 &&
        kids[0]?.tagName === 'BUTTON' &&
        kids[kids.length - 1]?.tagName === 'BUTTON' &&
        kids.slice(1, -1).some((k) => /\d/.test(k.textContent)) &&
        el.checkVisibility()
      );
    });
    if (!stepper) continue;
    const kids = [...stepper.children];
    const target =
      args.part === 'dec'
        ? kids[0]
        : args.part === 'inc'
          ? kids[kids.length - 1]
          : kids.slice(1, -1).find((k) => /\d/.test(k.textContent));
    if (!target) return false;
    target.setAttribute('data-sa-target', '');
    return true;
  }
  return false;
}

/**
 * Brings an element to the middle of the screen before it is hovered or measured, the way keyboard focus does.
 * Playwright's own `scrollIntoViewIfNeeded` ignores the page's `scroll-padding-top`, so it can leave a link under
 * the fixed header and then report "covered by the header" for a link a visitor reaches without trouble. Runs in
 * the page (`locator.evaluate(centre)`); no closures.
 */
export function centre(node: Element): void {
  node.scrollIntoView({ block: 'center', inline: 'nearest' });
}
