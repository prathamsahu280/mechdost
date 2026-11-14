'use client';

import { useEffect } from 'react';
import { rememberedErrorCopy } from '@/lib/error-copy';
import { reportClientError } from '@/lib/error-reporting';

/**
 * Last-resort error page: the root layout itself failed, so this replaces the whole document (review 2026-11-14).
 * The error goes to Sentry (`reportClientError`, no-op without a DSN). The words come from the locale files through
 * the copy remembered on load (`rememberErrorCopy`; no i18n runtime here); without them the page stays blank. Inline
 * styles only (light-theme values of `packages/ui/src/tokens.css`: bg, ink, muted, accent-button): the site's CSS
 * is part of the layout that failed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error);
  }, [error]);

  const saved = rememberedErrorCopy();
  return (
    <html lang={saved?.lang ?? 'en'}>
      <body
        style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#edf1f5', color: '#101f34' }}
      >
        {saved ? (
          <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 16px' }}>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>{saved.copy.title}</h1>
            <p style={{ marginTop: 8, fontSize: 15, color: '#536376' }}>{saved.copy.body}</p>
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: 20,
                minHeight: 44,
                padding: '0 20px',
                border: 0,
                borderRadius: 12,
                background: '#d2461a',
                color: '#fff',
                fontWeight: 700,
                fontSize: 15,
                cursor: 'pointer',
              }}
            >
              {saved.copy.tryAgain}
            </button>
          </main>
        ) : null}
      </body>
    </html>
  );
}
