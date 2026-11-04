import { describe, expect, it } from 'vitest';
import { cleanPolicy, fillPolicyText, POLICY_LIMITS } from '../src/policy';

const doc = {
  title: 'Privacy',
  lead: 'What we keep about you.',
  updatedOn: '2026-11-04',
  sections: [{ heading: 'Who we are', body: 'MechDost is run by {company}.\n\nCall {phone}.', emoji: '🏢' }],
};

describe('policy documents', () => {
  it('keeps paragraphs, cleans text and accepts the official placeholders', () => {
    const r = cleanPolicy({
      ...doc,
      title: '  Privacy\u200b  ',
      sections: [{ heading: ' Who  we are ', body: 'Line one\r\n\r\n\r\nLine\ttwo  ' }],
    });
    expect(r).toEqual({
      ok: true,
      doc: { ...doc, sections: [{ heading: 'Who we are', body: 'Line one\n\nLine two' }] },
    });
    expect(cleanPolicy(doc)).toMatchObject({ ok: true });
  });

  it('refuses a broken shape, empty sections, bad dates, typo placeholders, non-emoji icons and too many sections', () => {
    expect(cleanPolicy(null)).toEqual({ ok: false, problem: 'shape' });
    expect(cleanPolicy({ ...doc, sections: 'x' })).toEqual({ ok: false, problem: 'shape' });
    expect(cleanPolicy({ ...doc, sections: [{ heading: 'A', body: '   ' }] })).toEqual({
      ok: false,
      problem: 'empty',
    });
    expect(cleanPolicy({ ...doc, sections: [] })).toEqual({ ok: false, problem: 'empty' });
    expect(cleanPolicy({ ...doc, updatedOn: '2026-02-30' })).toEqual({ ok: false, problem: 'date' });
    expect(cleanPolicy({ ...doc, lead: 'Run by {compnay}' })).toEqual({
      ok: false,
      problem: 'unknown_placeholder',
    });
    expect(cleanPolicy({ ...doc, sections: [{ heading: 'A', body: 'b', emoji: '<b>' }] })).toEqual({
      ok: false,
      problem: 'emoji',
    });
    const many = Array.from({ length: POLICY_LIMITS.sections + 1 }, () => ({ heading: 'A', body: 'b' }));
    expect(cleanPolicy({ ...doc, sections: many })).toEqual({ ok: false, problem: 'too_many_sections' });
  });

  it('caps every field at its limit', () => {
    const r = cleanPolicy({ ...doc, sections: [{ heading: 'h'.repeat(500), body: 'b'.repeat(5000) }] });
    if (!r.ok) throw new Error('expected ok');
    expect(r.doc.sections[0]?.heading).toHaveLength(POLICY_LIMITS.heading);
    expect(r.doc.sections[0]?.body).toHaveLength(POLICY_LIMITS.body);
  });

  it('fills placeholders by plain replacement, leaving other braces alone', () => {
    const facts = { company: 'Shourya Integrated Services Pvt Ltd', address: 'Raipur', phone: '7978776551' };
    expect(fillPolicyText('By {company}, {address}. Call {phone}. {other}', facts)).toBe(
      'By Shourya Integrated Services Pvt Ltd, Raipur. Call 7978776551. {other}',
    );
  });
});
