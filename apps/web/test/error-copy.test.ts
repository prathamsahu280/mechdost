/**
 * The root error page's strings (review 2026-11-14): `global-error.tsx` replaces the whole document, so the layout's
 * JSON data block is gone when it renders. The copy and the page language are remembered on load instead.
 */
import { describe, expect, it } from 'vitest';
import { ERROR_COPY_ID, rememberErrorCopy, rememberedErrorCopy } from '../src/lib/error-copy';

const copy = { title: 'कुछ गड़बड़ हुई', body: 'फिर कोशिश करें', tryAgain: 'फिर कोशिश करें', trying: '…' };
// A stand-in with only what the function reads (an HTMLElement is not needed for `textContent`).
const doc = (text: string | null, lang = 'hi') =>
  ({
    getElementById: (id: string) => (id === ERROR_COPY_ID && text !== null ? { textContent: text } : null),
    documentElement: { lang },
  }) as unknown as Parameters<typeof rememberErrorCopy>[0];

describe('remembered error copy for the global error page', () => {
  it('is empty until read, then keeps the copy and the page language', () => {
    expect(rememberedErrorCopy()).toBeNull();
    rememberErrorCopy(doc('not json'));
    expect(rememberedErrorCopy()).toBeNull();
    rememberErrorCopy(doc(JSON.stringify(copy)));
    expect(rememberedErrorCopy()).toEqual({ copy, lang: 'hi' });
    // A page without the block (or a broken one) never erases what was read.
    rememberErrorCopy(doc(null, 'en'));
    expect(rememberedErrorCopy()).toEqual({ copy, lang: 'hi' });
  });
});
