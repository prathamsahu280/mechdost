import { describe, expect, it } from 'vitest';
import { externalLinkKind, externalLinkFindings } from '../e2e/state-audit/nav.ts';

const link = (raw: string, target = '', rel = '') => ({ href: '/x', text: 'Call', raw, target, rel });

describe('footer phone and WhatsApp links are checked by href, never opened (batch 3c-3)', () => {
  it('names the kind of an external link, and null for a page link', () => {
    expect(externalLinkKind('tel:+917978776551')).toBe('tel');
    expect(externalLinkKind('https://wa.me/917978776551?text=Hi')).toBe('whatsapp');
    expect(externalLinkKind('https://api.whatsapp.com/send?phone=917978776551')).toBe('whatsapp');
    expect(externalLinkKind('mailto:a@b.in')).toBe('mailto');
    expect(externalLinkKind('/hi/shop')).toBeNull();
    expect(externalLinkKind('https://example.com/a')).toBeNull();
  });

  it('passes the real support number on tel: and WhatsApp (new tab with noopener)', () => {
    expect(externalLinkFindings(link('tel:+917978776551'), '7978776551')).toEqual([]);
    expect(
      externalLinkFindings(
        link('https://wa.me/917978776551?text=Hi', '_blank', 'noopener noreferrer'),
        '7978776551',
      ),
    ).toEqual([]);
  });

  it('flags a wrong number, a malformed tel: and a WhatsApp link that opens in the same tab without noopener', () => {
    expect(externalLinkFindings(link('tel:+919999999999'), '7978776551')).toHaveLength(1);
    expect(externalLinkFindings(link('tel:call-us'), '7978776551')).toHaveLength(1);
    expect(externalLinkFindings(link('https://wa.me/917978776551'), '7978776551')).toHaveLength(1);
    expect(
      externalLinkFindings(link('https://wa.me/910000000000', '_blank', 'noopener'), '7978776551'),
    ).toHaveLength(1);
  });
});
