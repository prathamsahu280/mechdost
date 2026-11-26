'use client';

import { Camera, Trash2 } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import { fitWithin } from '@/lib/ustaad/media-core';

export interface PreparedImage {
  blob: Blob;
  mime: 'image/webp' | 'image/jpeg';
  width: number;
  height: number;
}

/** Long edge after shrinking (the API makes its own 480/1080 variants; this keeps uploads small on 4G). */
const MAX_EDGE = 1600;

/**
 * Draws the photo on a canvas and encodes it again: the new file carries no EXIF (no GPS, no phone model), is turned
 * the right way up, and is at most 1600 px on the long edge. WebP where the browser can encode it, else JPEG (both on
 * the API's list).
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const size = fitWithin(bitmap.width, bitmap.height, MAX_EDGE);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const encode = (type: string, q: number) =>
    new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, type, q);
    });
  const webp = await encode('image/webp', 0.8);
  if (webp?.type === 'image/webp') return { blob: webp, mime: 'image/webp', ...size };
  const jpeg = await encode('image/jpeg', 0.82);
  if (!jpeg) throw new Error('encode');
  return { blob: jpeg, mime: 'image/jpeg', ...size };
}

const quiet =
  'press inline-flex min-h-12 items-center justify-center gap-2 rounded-button border border-input-border bg-surface px-4 text-[15px] font-bold text-ink hover:bg-pill focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-focus';

/**
 * Photo picker (camera or gallery, the phone decides): shrinks and cleans the photo on the phone before anything is
 * sent, shows a small preview, and lets the member change or remove it. Reused by the feed composer (workstream D).
 */
export function ImagePicker({
  onChange,
  label,
}: {
  onChange: (img: PreparedImage | null) => void;
  /** Visible button text ("Add a photo", "Send signboard photo"…); defaults to "Add a photo". */
  label?: string;
}) {
  const t = useTranslations('ustaad.media');
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ url: string; width: number; height: number } | null>(null);
  const [status, setStatus] = useState<'preparing' | 'ready' | 'failed' | null>(null);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  async function pick(file: File | undefined) {
    if (!file) return;
    setStatus('preparing');
    try {
      const img = await prepareImage(file);
      setPreview({ url: URL.createObjectURL(img.blob), width: img.width, height: img.height });
      setStatus('ready');
      onChange(img);
    } catch {
      setStatus('failed');
      onChange(null);
    }
  }

  function remove() {
    setPreview(null);
    setStatus(null);
    onChange(null);
    if (input.current) input.current.value = '';
    input.current?.focus();
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={inputId} className={`${quiet} file-pick cursor-pointer`}>
          <Camera aria-hidden="true" className="size-5" />
          {preview ? t('photoChange') : (label ?? t('photoPick'))}
          <input
            ref={input}
            id={inputId}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            className="sr-only"
            data-track="ustaad_photo_pick"
            onChange={(e) => void pick(e.target.files?.[0])}
          />
        </label>
        {preview ? (
          <button type="button" className={quiet} data-track="ustaad_photo_remove" onClick={remove}>
            <Trash2 aria-hidden="true" className="size-5" />
            {t('photoRemove')}
          </button>
        ) : null}
      </div>
      {preview ? (
        <Image
          src={preview.url}
          alt={t('photoAlt')}
          width={preview.width}
          height={preview.height}
          unoptimized
          className="h-auto max-h-56 w-auto max-w-full rounded-2xl border border-line-card object-contain"
        />
      ) : null}
      <p role="status" className="text-sm text-muted empty:sr-only">
        {status === 'preparing'
          ? t('photoPreparing')
          : status === 'ready'
            ? t('photoReady')
            : status === 'failed'
              ? t('photoFailed')
              : ''}
      </p>
    </div>
  );
}
