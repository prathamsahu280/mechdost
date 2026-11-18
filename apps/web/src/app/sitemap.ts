import type { MetadataRoute } from 'next';
import { searchIndexingOpen } from '@/lib/seo';
import { sitemapEntries } from '@/lib/sitemap-entries';

/** Rebuilt at most hourly; a new product or workshop appears in the next rebuild (decisions 2026-11-17 "SEO"). */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Pre-launch (demo data): nothing to index yet (searchIndexingOpen).
  return searchIndexingOpen() ? sitemapEntries() : [];
}
