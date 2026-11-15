import { afterEach, describe, expect, it } from 'vitest';
import { behindOpenLayer, insetOverlapAllowed } from '../e2e/state-audit/geometry.ts';

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
const rect = (left: number, top: number, right: number, bottom: number): Rect => ({
  left,
  top,
  right,
  bottom,
});

/** A stand-in element: just the members `behindOpenLayer` reads. */
const fake = (r: Rect, opts: { visible?: boolean; children?: unknown[]; modal?: boolean } = {}) => {
  const self: Record<string, unknown> = {
    getBoundingClientRect: () => r,
    checkVisibility: () => opts.visible ?? true,
    matches: (sel: string) => sel === ':modal' && opts.modal === true,
    contains: (x: unknown) => x === self || (opts.children ?? []).includes(x),
  };
  return self;
};

const withLayers = (layers: unknown[]) => {
  (globalThis as { document?: unknown }).document = { querySelectorAll: () => layers };
};
afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

describe('behindOpenLayer: no hover under an open dialog, popover or viewer (batch 3c-3)', () => {
  it('is true when the control centre is under an open layer, wherever the layer sits in the DOM', () => {
    withLayers([fake(rect(100, 100, 500, 500))]);
    expect(behindOpenLayer(fake(rect(200, 200, 260, 244)) as unknown as Element)).toBe(true);
  });
  it('is false beside the layer, inside it, or when the layer is not visible', () => {
    const inside = fake(rect(200, 200, 260, 244));
    withLayers([fake(rect(100, 100, 500, 500), { children: [inside] })]);
    expect(behindOpenLayer(inside as unknown as Element)).toBe(false);
    withLayers([fake(rect(100, 100, 500, 500))]);
    expect(behindOpenLayer(fake(rect(600, 600, 660, 644)) as unknown as Element)).toBe(false);
    withLayers([fake(rect(100, 100, 500, 500), { visible: false })]);
    expect(behindOpenLayer(fake(rect(200, 200, 260, 244)) as unknown as Element)).toBe(false);
  });
  it('a modal dialog (showModal) blocks every control outside it: its ::backdrop covers the whole viewport (batch 3c-4)', () => {
    // API-SVC-PHOTOS at 1280: the opener buttons sit beside the 900 px dialog box, not under it, yet Playwright
    // reports "<dialog open> intercepts pointer events" because the backdrop belongs to the dialog.
    withLayers([fake(rect(190, 100, 1090, 700), { modal: true })]);
    expect(behindOpenLayer(fake(rect(20, 300, 80, 344)) as unknown as Element)).toBe(true);
  });
  it('a modal dialog never blocks its own controls, and a non-modal open dialog still blocks only its box', () => {
    const inside = fake(rect(300, 300, 360, 344));
    withLayers([fake(rect(190, 100, 1090, 700), { modal: true, children: [inside] })]);
    expect(behindOpenLayer(inside as unknown as Element)).toBe(false);
    withLayers([fake(rect(190, 100, 1090, 700))]);
    expect(behindOpenLayer(fake(rect(20, 300, 80, 344)) as unknown as Element)).toBe(false);
  });
  it('is false with no open layer', () => {
    withLayers([]);
    expect(behindOpenLayer(fake(rect(0, 0, 50, 50)) as unknown as Element)).toBe(false);
  });
});

describe('insetOverlapAllowed: a marked control inside its own field is not an overlap (batch 3c-3)', () => {
  const field = (wrapper: object) => ({ isField: true, wrapper });
  const wrapper = {};
  it('allows the marked toggle over the input of the same wrapper', () => {
    expect(insetOverlapAllowed({ inset: true, wrapper }, field(wrapper))).toBe(true);
    expect(insetOverlapAllowed(field(wrapper), { inset: true, wrapper })).toBe(true);
  });
  it('still fails an unmarked control over the input', () => {
    expect(insetOverlapAllowed({ inset: false, wrapper }, field(wrapper))).toBe(false);
  });
  it('still fails a marked control over a different wrapper or over a non-field', () => {
    expect(insetOverlapAllowed({ inset: true, wrapper }, field({}))).toBe(false);
    expect(insetOverlapAllowed({ inset: true, wrapper }, { isField: false, wrapper })).toBe(false);
  });
  it('still fails two fields or two marked controls', () => {
    expect(insetOverlapAllowed(field(wrapper), field(wrapper))).toBe(false);
    expect(insetOverlapAllowed({ inset: true, wrapper }, { inset: true, wrapper })).toBe(false);
  });
});
