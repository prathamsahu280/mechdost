import { describe, expect, it } from 'vitest';
import { cleanCompany, companyFor, EMPTY_COMPANY, grievanceContactLine, readCompany } from '../src/company';
import {
  cleanHomeLayout,
  DEFAULT_FEATURED,
  DEFAULT_HOME_LAYOUT,
  featuredCategories,
  HOME_SECTIONS,
  readHomeLayout,
  visibleSections,
} from '../src/site-layout';

const FALLBACK = {
  company: 'Built-in Pvt Ltd',
  registeredAddress: 'Built-in address',
  gstin: '22ABVCS4888H1ZL',
};

describe('company details', () => {
  it('cleans and checks formats; empty means not filled', () => {
    const r = cleanCompany({
      legalName: '  Shourya   Integrated  ',
      cin: ' u74999cT2020ptc012345 ',
      gstin: '22abvcs4888h1zl',
      grievanceEmail: ' Help@MechDost.com ',
      grievancePhone: '+91 79787-76551',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.details.legalName).toBe('Shourya Integrated');
    expect(r.details.cin).toBe('U74999CT2020PTC012345');
    expect(r.details.gstin).toBe('22ABVCS4888H1ZL');
    expect(r.details.grievanceEmail).toBe('help@mechdost.com');
    expect(r.details.grievancePhone).toBe('+917978776551');
    expect(r.details.grievanceName).toBe('');
  });

  it('names the first field that does not fit', () => {
    expect(cleanCompany({ cin: 'nope' })).toEqual({ ok: false, field: 'cin', problem: 'format' });
    expect(cleanCompany({ gstin: '123' })).toEqual({ ok: false, field: 'gstin', problem: 'format' });
    expect(cleanCompany({ grievanceEmail: 'a b@c' })).toMatchObject({ ok: false, field: 'grievanceEmail' });
    expect(cleanCompany({ grievancePhone: 'call me' })).toMatchObject({ ok: false, field: 'grievancePhone' });
    expect(cleanCompany({ legalName: 5 })).toMatchObject({ ok: false, field: 'legalName' });
  });

  it('shows nothing for the CIN and the grievance officer until filled; legal facts fall back to the built-ins', () => {
    const empty = companyFor(EMPTY_COMPANY, 'en', FALLBACK);
    expect(empty).toMatchObject({ company: 'Built-in Pvt Ltd', cin: null, grievance: null });
    const filled = companyFor(
      { ...EMPTY_COMPANY, legalName: 'Admin Name', cin: 'U74999CT2020PTC012345', grievanceEmail: 'g@x.in' },
      'en',
      FALLBACK,
    );
    expect(filled.company).toBe('Admin Name');
    expect(filled.cin).toBe('U74999CT2020PTC012345');
    expect(filled.grievance).toEqual({ name: null, email: 'g@x.in', phone: null });
  });

  it('Hindi pages never fall back to the admin English text', () => {
    const d = { ...EMPTY_COMPANY, legalName: 'English Name', registeredAddress: 'English address' };
    const hi = companyFor(d, 'hi', { ...FALLBACK, company: 'हिंदी नाम', registeredAddress: 'हिंदी पता' });
    expect(hi.company).toBe('हिंदी नाम');
    expect(hi.registeredAddress).toBe('हिंदी पता');
    expect(companyFor({ ...d, legalNameHi: 'प्रशासक नाम' }, 'hi', FALLBACK).company).toBe('प्रशासक नाम');
  });

  it('a hand-edited stored row never breaks a page', () => {
    expect(readCompany(null)).toEqual(EMPTY_COMPANY);
    expect(readCompany({ cin: 'bad', legalName: 'Ok', gstin: 7 })).toEqual({
      ...EMPTY_COMPANY,
      legalName: 'Ok',
    });
  });

  it('builds the email footer line from what is filled', () => {
    expect(grievanceContactLine(EMPTY_COMPANY)).toBeNull();
    expect(grievanceContactLine({ ...EMPTY_COMPANY, grievanceName: 'A B', grievanceEmail: 'g@x.in' })).toBe(
      'A B · g@x.in',
    );
  });
});

describe('home layout', () => {
  const ok = { ...DEFAULT_HOME_LAYOUT, featured: null };

  it('accepts the default and appends any section the order leaves out', () => {
    const r = cleanHomeLayout({ ...ok, order: ['faq', 'trust'] });
    expect(r.ok && r.layout.order).toEqual([
      'faq',
      'trust',
      ...HOME_SECTIONS.filter((s) => s !== 'faq' && s !== 'trust'),
    ]);
  });

  it('refuses unknown or repeated sections, bad tile counts and non-emoji text', () => {
    expect(cleanHomeLayout({ ...ok, order: ['nope'] })).toEqual({ ok: false, problem: 'section' });
    expect(cleanHomeLayout({ ...ok, hidden: ['faq', 'faq'] })).toEqual({ ok: false, problem: 'section' });
    expect(cleanHomeLayout({ ...ok, featured: ['tyres', 'lubricants'] })).toEqual({
      ok: false,
      problem: 'featured_count',
    });
    expect(cleanHomeLayout({ ...ok, featured: ['tyres', 'tyres', 'filters'] })).toEqual({
      ok: false,
      problem: 'shape',
    });
    expect(cleanHomeLayout({ ...ok, emoji: { tyres: '<b>' } })).toEqual({ ok: false, problem: 'emoji' });
    expect(cleanHomeLayout({ ...ok, emoji: { nope: '🛞' } })).toEqual({ ok: false, problem: 'shape' });
    expect(cleanHomeLayout({ ...ok, mapDefault: 'moon' })).toEqual({ ok: false, problem: 'shape' });
    expect(cleanHomeLayout('x')).toEqual({ ok: false, problem: 'shape' });
  });

  it('keeps emoji overrides, drops blank ones, and a garbage stored row is the default', () => {
    const r = cleanHomeLayout({ ...ok, emoji: { tyres: '🛞', filters: ' ' } });
    expect(r.ok && r.layout.emoji).toEqual({ tyres: '🛞' });
    expect(readHomeLayout({ order: 3 })).toEqual(DEFAULT_HOME_LAYOUT);
  });

  it('renders visible sections in order and the default six tiles until chosen', () => {
    const r = cleanHomeLayout({ ...ok, order: ['faq', 'trust'], hidden: ['trust'] });
    expect(r.ok && visibleSections(r.layout)[0]).toBe('faq');
    expect(r.ok && visibleSections(r.layout)).not.toContain('trust');
    expect(featuredCategories(DEFAULT_HOME_LAYOUT)).toEqual(DEFAULT_FEATURED);
  });
});
