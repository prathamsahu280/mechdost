import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/seo';
import { PRIVATE_PATHS } from '@/lib/sitemap-entries';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [...PRIVATE_PATHS.flatMap((p) => [p, `/hi${p}`]), '/api/'],
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
