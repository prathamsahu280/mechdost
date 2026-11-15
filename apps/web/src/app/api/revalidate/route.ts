/**
 * Refresh the website's cached content by tag (design 2026-11-15 items 5, 6, 8). Called server to server by the API
 * after a publish, with the shared secret in `x-revalidate-secret`; see `@/lib/revalidate-request` for the rules.
 * Never called from a browser, so it sends no CORS headers.
 */
import { revalidateTag } from 'next/cache';
import { NextResponse, type NextRequest } from 'next/server';
import { checkRevalidate } from '@/lib/revalidate-request';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // an unreadable body is refused below
  }
  const checked = checkRevalidate(
    process.env.REVALIDATE_SECRET,
    req.headers.get('x-revalidate-secret'),
    body,
  );
  if (!checked.ok) return NextResponse.json({ error: 'refused' }, { status: checked.status });
  // `max`: stale content is served while the fresh copy loads in the background, then it is replaced.
  for (const tag of checked.tags) revalidateTag(tag, 'max');
  return NextResponse.json({ ok: true, tags: checked.tags });
}
