import type { MetadataRoute } from 'next';
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
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
