import { describe, expect, it } from 'vitest';
import {
  CONTENT_KEYS,
  TRUST_HIDDEN,
  TRUST_PLACEMENTS,
  cleanContentText,
  contentMax,
  isTrustKey,
  trustKey,
  trustLineText,
  trustPlacementOf,
} from '../src/content';
import { defaultEmailTrustLine, renderEmailLayout } from '../src/email-layout';
import { PARTNER_STANDING_REASONS, STAFF_STANDING_REASONS } from '../src/partner-codes';
import { GENUINE_CLAUSE, genuineClauseText, withGenuineClause } from '../src/seller-clause';
import { labourPromiseEndsAt, labourPromiseOpen } from '../src/service-bill';
import { OPERATIONAL_SETTINGS, settingProblem } from '../src/settings';
import { SUPPORT_TICKET_KINDS } from '../src/support-api';
import en from '../src/i18n/en.json';
import hi from '../src/i18n/hi.json';

describe('trust lines (design 2026-11-15)', () => {
  it('registers one content key per placement', () => {
    for (const p of TRUST_PLACEMENTS) {
      expect(CONTENT_KEYS).toContain(trustKey(p));
      expect(isTrustKey(trustKey(p))).toBe(true);
      expect(trustPlacementOf(trustKey(p))).toBe(p);
    }
    expect(isTrustKey('hero.lead')).toBe(false);
    expect(isTrustKey('trust.unknown')).toBe(false);
    expect(trustPlacementOf('hero.lead')).toBeNull();
  });

  it('has an English and a Hindi default for every placement', () => {
    for (const p of TRUST_PLACEMENTS) {
      expect(en.trust[p], p).toBeTruthy();
      expect(hi.trust[p], p).toBeTruthy();
    }
  });

  it('allows longer text than the short site texts, and cleans it', () => {
    expect(contentMax('trust.checkout')).toBeGreaterThan(contentMax('hero.eyebrow'));
    expect(cleanContentText('trust.checkout', '  Only   original parts \u200b ')).toBe('Only original parts');
  });

  it('shows the default when there is no override', () => {
    expect(trustLineText(undefined, 'Default')).toBe('Default');
    expect(trustLineText('   ', 'Default')).toBe('Default');
  });

  it('hides the line when the override is the hide marker', () => {
    expect(trustLineText(TRUST_HIDDEN, 'Default')).toBeNull();
    expect(trustLineText(` ${TRUST_HIDDEN} `, 'Default')).toBeNull();
  });

  it('fills {brand}, and falls back when the page has no brand', () => {
    expect(trustLineText('Genuine {brand} part', 'Default', { brand: 'Bosch' })).toBe('Genuine Bosch part');
    expect(trustLineText('Genuine {brand} part', 'Default', { brand: ' ' })).toBe('Default');
    expect(trustLineText('Genuine {brand} part', 'Default')).toBe('Default');
    expect(trustLineText('Genuine part', 'Default', { brand: 'Bosch' })).toBe('Genuine part');
  });

  it('keeps the order-email default equal to the locale-file default', () => {
    expect(defaultEmailTrustLine('en')).toBe(
      en.trust.emailFooter.replace('{region}', en.regions.chhattisgarh),
    );
    expect(defaultEmailTrustLine('hi')).toBe(
      hi.trust.emailFooter.replace('{region}', hi.regions.chhattisgarh),
    );
  });

  it('puts the trust line above the company line, only when given', () => {
    const body = { subject: 's', heading: 'h', paragraphs: ['p'], action: null };
    const withLine = renderEmailLayout(body, {
      locale: 'en',
      grievanceContact: null,
      trustLine: 'Only genuine.',
    });
    expect(withLine.text.indexOf('Only genuine.')).toBeLessThan(withLine.text.indexOf('Shourya'));
    expect(withLine.html).toContain('Only genuine.');
    expect(renderEmailLayout(body, { locale: 'en', grievanceContact: null }).text).not.toContain('genuine');
  });

  it('counterfeit_confirmed is a staff standing reason with an English and a Hindi label', () => {
    expect(PARTNER_STANDING_REASONS).toContain('counterfeit_confirmed');
    expect(STAFF_STANDING_REASONS).toContain('counterfeit_confirmed');
    for (const reason of PARTNER_STANDING_REASONS) {
      const key = `shops_api_reason_${reason}` as keyof typeof en.portal;
      expect(en.portal[key], key).toBeTruthy();
      expect(hi.portal[key], key).toBeTruthy();
    }
  });

  it('the seller clause exists in both languages and is added once', () => {
    expect(GENUINE_CLAUSE.en.body).toContain('genuine');
    expect(GENUINE_CLAUSE.hi.body).toContain('असली');
    for (const locale of ['en', 'hi'] as const) {
      const once = withGenuineClause('Existing agreement text.', locale);
      expect(once.startsWith('Existing agreement text.')).toBe(true);
      expect(withGenuineClause(once, locale)).toBe(once);
      expect(withGenuineClause('', locale)).toBe(genuineClauseText(locale));
    }
  });

  it('labels the labour-redo ticket kind and the labour promise settings in both languages', () => {
    expect(SUPPORT_TICKET_KINDS).toContain('labour_redo');
    expect(en.support.kind_labour_redo).toBeTruthy();
    expect(hi.support.kind_labour_redo).toBeTruthy();
    expect(OPERATIONAL_SETTINGS['service.labour_promise_enabled'].default).toBe(false);
    expect(settingProblem('service.labour_promise_days', 6)).toBe('range');
    expect(settingProblem('service.labour_promise_days', 91)).toBe('range');
    expect(settingProblem('service.labour_promise_days', 30)).toBeNull();
    expect(settingProblem('service.labour_promise_enabled', 'yes')).toBe('type');
  });

  it('runs the promise for whole days from the bill', () => {
    const billed = new Date('2026-11-01T10:00:00Z');
    expect(labourPromiseEndsAt(billed, 30).toISOString()).toBe('2026-12-01T10:00:00.000Z');
    expect(labourPromiseOpen(billed, 30, new Date('2026-12-01T09:59:00Z'))).toBe(true);
    expect(labourPromiseOpen(billed, 30, new Date('2026-12-01T10:01:00Z'))).toBe(false);
    expect(labourPromiseOpen(billed, null, billed)).toBe(false);
  });

  it('keeps the default claims truthful (no sealed-pack or GST-on-every-order claim)', () => {
    const all = [...Object.values(en.trust), ...Object.values(hi.trust)].join(' ').toLowerCase();
    expect(all).not.toContain('sealed');
    expect(all).not.toContain('सील');
    for (const p of TRUST_PLACEMENTS) expect(en.trust[p].toLowerCase(), p).not.toContain('gst bill on every');
  });
});
