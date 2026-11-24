import type { MetadataRoute } from 'next';
import { BLOCKED_CRAWLERS } from '@/lib/crawler-blocklist';
import { absoluteUrl } from '@/lib/seo';
import { PRIVATE_PATHS } from '@/lib/sitemap-entries';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // The public Bulk orders form sits under /quotes/, whose records stay blocked (longest rule wins).
        allow: ['/', '/quotes/new', '/hi/quotes/new'],
        disallow: [...PRIVATE_PATHS.flatMap((p) => [p, `/hi${p}`]), '/api/'],
      },
      // AI-training scrapers and SEO-tool crawlers (decision 2026-11-24): asked to stay away, one group each.
      // Search engines and link-preview fetchers are not listed, so they follow the `*` group above.
      { userAgent: [...BLOCKED_CRAWLERS], disallow: '/' },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
