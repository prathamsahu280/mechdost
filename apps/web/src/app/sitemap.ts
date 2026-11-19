import type { MetadataRoute } from 'next';
import { sitemapEntries } from '@/lib/sitemap-entries';

/**
 * Rebuilt at most hourly; a new product or workshop appears in the next rebuild (decisions 2026-11-17 "SEO"). Open in
 * demo mode too (user 2026-11-19: index every public page now; demo workshops stay out, sitemap-entries.ts).
 */
export const revalidate = 3600;

export default function sitemap(): Promise<MetadataRoute.Sitemap> {
  return sitemapEntries();
}
