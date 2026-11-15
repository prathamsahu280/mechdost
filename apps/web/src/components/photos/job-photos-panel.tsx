'use client';

import { Camera, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  photoRemovable,
  photoStageOpen,
  PHOTO_STAGES,
  type PhotoStage,
  type ServicePhotos,
} from '@mechdost/shared/service-photos';
import type { ServiceRequestStatus } from '@mechdost/shared/state';
import { portalQuiet } from '@/components/portal/portal-styles';
import { PhotoViewer, PhotoThumb } from './photo-viewer';

type Load = { kind: 'loading' } | { kind: 'error'; code: string } | { kind: 'ok'; data: ServicePhotos };

/** Statuses from which a job card shows photos at all (from the confirmed visit on). */
const SHOWN: readonly ServiceRequestStatus[] = [
  'confirmed',
  'vehicle_received',
  'estimate_sent',
  'approved',
  'no_work_approved',
  'in_progress',
  'ready',
  'billed',
  'paid',
  'completed',
];

/**
 * The job card's photo section (spec 06 "Job photos"): before and after, thumbnails with remove, a camera button on
 * phones (`capture`), one at a time with progress, errors next to the button in the workshop's language. What may
 * be added or removed follows the shared status windows; the API checks them again. `onChanged` lets the card
 * refresh (the gate message clears once a photo is there).
 */
export function JobPhotosPanel({
  code,
  status,
  onChanged,
}: {
  code: string;
  status: ServiceRequestStatus;
  onChanged?: () => void;
}) {
  const t = useTranslations('photos');
  const locale = useLocale();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [busy, setBusy] = useState<{ stage: PhotoStage; done: number; total: number } | null>(null);
  const [errors, setErrors] = useState<Partial<Record<PhotoStage, string>>>({});
  const [note, setNote] = useState('');
  const [viewing, setViewing] = useState<number | null>(null);
  const live = useRef(true);

  const refresh = useCallback(async () => {
    const { fetchWorkshopPhotos } = await import('@/lib/photos-api');
    const res = await fetchWorkshopPhotos(locale, code);
    if (!live.current) return;
    setLoad(res.ok ? { kind: 'ok', data: res.data } : { kind: 'error', code: res.code });
  }, [code, locale]);

  useEffect(() => {
    live.current = true;
    void refresh();
    return () => {
      live.current = false;
    };
  }, [refresh]);

  if (!SHOWN.includes(status)) return null;

  async function onPick(stage: PhotoStage, files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const { uploadPhoto, photoErrorKey } = await import('@/lib/photos-api');
    setErrors((e) => ({ ...e, [stage]: undefined }));
    for (const [i, file] of list.entries()) {
      setBusy({ stage, done: i + 1, total: list.length });
      const res = await uploadPhoto(locale, code, stage, file);
      if (!res.ok) {
        setErrors((e) => ({ ...e, [stage]: photoErrorKey(res.code) }));
        break;
      }
      setNote(t('uploaded'));
    }
    setBusy(null);
    await refresh();
    onChanged?.();
  }

  async function onRemove(stage: PhotoStage, photoId: string) {
    const { removePhoto, photoErrorKey } = await import('@/lib/photos-api');
    setErrors((e) => ({ ...e, [stage]: undefined }));
    const res = await removePhoto(locale, code, photoId);
    if (res.ok) setNote(t('removed'));
    else setErrors((e) => ({ ...e, [stage]: photoErrorKey(res.code) }));
    await refresh();
    onChanged?.();
  }

  if (load.kind === 'loading')
    return (
      <p role="status" className="mt-4 border-t border-line pt-4 text-sm text-muted">
        {t('loading')}
      </p>
    );
  if (load.kind === 'error')
    return (
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <p role="alert" className="text-sm font-bold text-error">
          {t('loadFailed')}
        </p>
        <button type="button" onClick={() => void refresh()} className={portalQuiet}>
          {t('retry')}
        </button>
      </div>
    );

  const { photos, required, maxPerStage } = load.data;
  const all = photos;

  return (
    <section aria-labelledby={`${code}-photos`} className="mt-4 space-y-4 border-t border-line pt-4">
      <h3 id={`${code}-photos`} className="text-sm font-extrabold text-ink">
        {t('sectionTitle')}
      </h3>
      {PHOTO_STAGES.map((stage) => {
        const mine = all.filter((p) => p.stage === stage);
        const canAdd = photoStageOpen(stage, status) && mine.length < maxPerStage;
        const canRemove = photoRemovable(status);
        const inputId = `${code}-photo-${stage}`;
        const error = errors[stage];
        const uploading = busy?.stage === stage;
        if (mine.length === 0 && !photoStageOpen(stage, status) && stage === 'after' && status !== 'ready')
          return (
            <p key={stage} className="text-xs text-muted">
              {t('afterLater')}
            </p>
          );
        if (mine.length === 0 && !photoStageOpen(stage, status)) return null;
        return (
          <div key={stage}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-bold text-ink">
                {t(stage === 'before' ? 'beforeTitle' : 'afterTitle')}
                {required ? (
                  <span className="ms-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent-soft-text">
                    {t('needed')}
                  </span>
                ) : null}
              </p>
              <p className="text-xs text-muted">{t('count', { count: mine.length, max: maxPerStage })}</p>
            </div>
            <p className="mt-1 text-xs text-muted">
              {t(`${stage}Hint${required ? 'Required' : 'Optional'}`)}
            </p>
            {mine.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {mine.map((p, i) => (
                  <li key={p.id} className="relative">
                    <PhotoThumb
                      photo={p}
                      index={i}
                      total={mine.length}
                      onOpen={(n) => {
                        setViewing(all.findIndex((x) => x.id === mine[n]?.id));
                      }}
                    />
                    {canRemove ? (
                      <button
                        type="button"
                        onClick={() => void onRemove(stage, p.id)}
                        aria-label={t('remove', { stage: t(`stage_${stage}`), n: i + 1 })}
                        className="absolute -end-2 -top-2 inline-flex size-11 items-center justify-center"
                      >
                        <span className="inline-flex size-6 items-center justify-center rounded-full bg-ink text-white">
                          <X aria-hidden="true" className="size-3.5" />
                        </span>
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {canAdd ? (
              <div className="mt-2">
                <label
                  htmlFor={inputId}
                  aria-disabled={uploading || undefined}
                  className={`file-pick ${portalQuiet} cursor-pointer gap-2 ${uploading ? 'pointer-events-none opacity-60' : ''}`}
                >
                  <Camera aria-hidden="true" className="size-4" />
                  {t(stage === 'before' ? 'addBefore' : 'addAfter')}
                </label>
                <input
                  id={inputId}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  multiple
                  disabled={uploading}
                  className="sr-only"
                  onChange={(e) => {
                    const input = e.currentTarget;
                    void onPick(stage, input.files).then(() => {
                      input.value = '';
                    });
                  }}
                />
              </div>
            ) : null}
            {uploading ? (
              <p role="status" className="mt-2 text-xs font-bold text-muted">
                {t('uploading', { done: busy.done, total: busy.total })}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="mt-2 text-sm font-bold text-error">
                {t(error as 'err_generic', { max: maxPerStage })}
              </p>
            ) : null}
          </div>
        );
      })}
      <p role="status" className="sr-only">
        {note}
      </p>
      <PhotoViewer
        photos={all}
        index={viewing}
        onIndex={setViewing}
        onClose={() => {
          setViewing(null);
        }}
      />
    </section>
  );
}
