import { jsonLdText } from '@/lib/structured-data';

/** Structured data for search engines (server-rendered, no client JS). The JSON comes from our own builders. */
export function JsonLd({ data }: { data: Record<string, unknown> | readonly Record<string, unknown>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(data) }} />;
}
