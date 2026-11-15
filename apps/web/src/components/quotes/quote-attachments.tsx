'use client';

import { Check, Paperclip, X } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef } from 'react';
import type { QuoteAttachment } from '@mechdost/shared/quote-api';
import { photoSrc } from '@/lib/photo-src';

/**
 * Photos in the bulk quote thread (spec 19), for the customer thread and the staff desk: thumbnails of a message
 * (each opens the large copy in a new tab; no overlay to close), the picker of the composer, and the "Seen" mark.
 * Images are reached only through the short-lived signed URLs the API issues.
 */
export function QuoteAttachments({ attachments }: { attachments: readonly QuoteAttachment[] }) {
  const t = useTranslations('quote');
  if (attachments.length === 0) return null;
  return (
    <ul aria-label={t('api_attachedLabel')} className="mt-2 flex flex-wrap gap-2">
      {attachments.map((a, i) => (
        <li key={a.id}>
          <a
            href={photoSrc(a.largeUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="relative block size-20 overflow-hidden rounded-lg border border-line-card bg-pill focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <Image
              src={photoSrc(a.thumbUrl)}
              alt={t('api_attachOpen', { n: i + 1, total: attachments.length })}
              fill
              sizes="80px"
              unoptimized
              className="object-cover"
            />
          </a>
        </li>
      ))}
    </ul>
  );
}

/** "Seen" under a message the other side has read (never says who). */
export function SeenMark() {
  const t = useTranslations('quote');
  return (
    <span className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-muted">
      <Check aria-hidden="true" className="size-3" />
      {t('api_seen')}
    </span>
  );
}

/**
 * The composer's photo picker: an "Add photos" button, the chosen photos as small previews with a remove button each.
 * The parent owns the list (and checks it with `quotePhotoProblem`); previews are local object URLs, revoked on change.
 */
export function PhotoPicker({
  files,
  onChange,
  disabled,
  describedBy,
}: {
  files: readonly File[];
  onChange: (next: File[]) => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  const t = useTranslations('quote');
  const input = useRef<HTMLInputElement>(null);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(
    () => () => {
      for (const url of previews) URL.revokeObjectURL(url);
    },
    [previews],
  );

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        tabIndex={-1}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (picked.length > 0) onChange([...files, ...picked]);
        }}
      />
      <button
        type="button"
        disabled={disabled}
        aria-describedby={describedBy}
        onClick={() => input.current?.click()}
        className="press inline-flex min-h-11 items-center gap-2 rounded-button border border-input-border px-3 text-sm font-bold text-ink hover:bg-pill disabled:opacity-50"
      >
        <Paperclip aria-hidden="true" className="size-4" />
        {t('api_attach')}
      </button>
      {files.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-3">
          {files.map((f, i) => (
            <li key={`${f.name}-${String(i)}-${String(f.size)}`} className="relative">
              <span className="relative block size-16 overflow-hidden rounded-lg border border-line-card bg-pill">
                {previews[i] ? (
                  <Image
                    src={previews[i]}
                    alt={t('api_attachAlt', { n: i + 1, total: files.length })}
                    fill
                    sizes="64px"
                    unoptimized
                    className="object-cover"
                  />
                ) : null}
              </span>
              <button
                type="button"
                aria-label={t('api_attachRemove', { n: i + 1 })}
                onClick={() => {
                  onChange(files.filter((_, j) => j !== i));
                }}
                className="press absolute -right-2 -top-2 inline-flex size-8 touch-manipulation items-center justify-center rounded-full bg-ink text-white focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
