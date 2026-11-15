import { describe, expect, it } from 'vitest';
import { renderEmailLayout } from '../src/email-layout';

const body = { subject: 's', heading: 'h', paragraphs: ['p'], action: null };

describe('email header logo', () => {
  it('shows the logo image with the brand as alt text once the site origin is known', () => {
    const { html } = renderEmailLayout(body, {
      locale: 'en',
      grievanceContact: null,
      webBaseUrl: 'https://mechdost.example/',
    });
    expect(html).toContain('src="https://mechdost.example/brand/icons/email-logo.png"');
    expect(html).toContain('alt="MechDost"');
    expect(html).toContain('width="160" height="29"');
  });

  it('falls back to the plain wordmark without an origin', () => {
    const { html } = renderEmailLayout(body, { locale: 'hi', grievanceContact: null });
    expect(html).not.toContain('<img');
    expect(html).toContain('>MechDost</span>');
  });
});
