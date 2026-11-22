import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { warmUrls, waitBeforeNext } from '../scripts/warm-cache.mjs';

const xml = `<urlset>
<url><loc>https://mechdost.com/shop/castrol-a</loc></url>
<url><loc>https://mechdost.com/hi/shop</loc></url>
<url><loc>https://mechdost.com/hi/shop/castrol-a</loc></url>
<url><loc>https://mechdost.com/workshops</loc></url>
<url><loc>https://mechdost.com/</loc></url>
<url><loc>https://other.example/shop/x</loc></url>
<url><loc>https://mechdost.com/shop/castrol-a</loc></url>
</urlset>`;

describe('warm-up script', () => {
  it('lists own pages once, home and shop first, product pages last, other hosts never', () => {
    const urls = warmUrls(xml, 'https://mechdost.com') as string[];
    expect(urls).toEqual([
      'https://mechdost.com/',
      'https://mechdost.com/hi/shop',
      'https://mechdost.com/workshops',
      'https://mechdost.com/shop/castrol-a',
      'https://mechdost.com/hi/shop/castrol-a',
    ]);
  });

  it('keeps one gap between request starts (stays under the API rate limit)', () => {
    expect(waitBeforeNext(1000, 1300, 1000)).toBe(700);
    expect(waitBeforeNext(1000, 2500, 1000)).toBe(0);
  });
});
