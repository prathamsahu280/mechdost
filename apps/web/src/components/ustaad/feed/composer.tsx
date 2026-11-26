'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import type { TagListItem } from '@mechdost/shared/ustaad/dto/feed';
import { localePath } from '@/lib/locale-path';
import { ustaadClient, type MediaDeclare } from '@/lib/ustaad/client';
import {
  buildPostInput,
  durationLabel,
  sizeLabel,
  type ComposerKind,
  type PostDraft,
} from '@/lib/ustaad/feed-view';
import { btnPrimary, btnQuiet, card, fieldClass, SampleNote } from '../common';
import { correctForSend, SmartCorrection, type CorrectionMeta } from '../correction/smart-correction';
import { prepareImage, type PreparedImage } from '../media/image-picker';
import { UploadProgress } from '../media/upload-progress';
import { VoiceRecorder, type Recording } from '../media/voice-recorder';
import { UstaadIcon, type UstaadIconName } from '../shell/icons';
import { useSocialAction, useSocialError } from './social-common';

const MAX_PHOTOS = 10;
const MAX_TAGS = 5;
const VOICE_MAX_S = 120;
/** One signed PUT carries at most 16 MB (the resumable path is not built yet, Q-U-DW1). */
const SINGLE_PUT_BYTES = 16 * 1024 * 1024;

type Choice =
  'voice' | 'photo' | 'video' | 'text' | 'poll' | 'link' | 'document' | 'fix_log' | 'tip' | 'before_after';

const KIND_TILES: readonly { choice: Choice; icon: UstaadIconName }[] = [
  { choice: 'voice', icon: 'mic' },
  { choice: 'photo', icon: 'photo' },
  { choice: 'video', icon: 'video' },
  { choice: 'text', icon: 'comment' },
  { choice: 'poll', icon: 'poll' },
  { choice: 'link', icon: 'link' },
  { choice: 'document', icon: 'doc' },
];
const QUICK: readonly { choice: Choice; icon: UstaadIconName }[] = [
  { choice: 'fix_log', icon: 'jobs' },
  { choice: 'tip', icon: 'learn' },
  { choice: 'before_after', icon: 'photo' },
];

function kindOf(c: Choice): ComposerKind {
  if (c === 'fix_log' || c === 'tip') return 'text';
  if (c === 'before_after') return 'photo';
  return c;
}

interface Photo extends PreparedImage {
  url: string;
  role: 'before' | 'after';
}

/** The length of a picked video, read on the phone (the API checks it again). */
function videoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    const url = URL.createObjectURL(file);
    v.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : 0);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    v.src = url;
  });
}

/** Curated tags only (spec 23 § 4 flow 4, max 5): type to search the admin list, tap to add, tap a chip to remove. */
function TagPicker({ value, onChange }: { value: TagListItem[]; onChange: (tags: TagListItem[]) => void }) {
  const t = useTranslations('ustaad.feed');
  const locale = useLocale();
  const client = useSocialAction();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<TagListItem[]>([]);
  const inputId = useId();
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    const id = window.setTimeout(() => {
      void client()
        .then((c) => c.tags(q))
        .then((r) => {
          if (live && r.ok) setFound(r.data.slice(0, 12));
        });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [q, client]);
  const label = (x: TagListItem) => `#${locale === 'hi' ? x.nameHi : x.nameEn}`;
  const full = value.length >= MAX_TAGS;
  return (
    <fieldset className="grid gap-2">
      <legend className="font-heading text-base font-extrabold text-ink">{t('tagsLabel')}</legend>
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {value.map((x) => (
            <li key={x.slug}>
              <button
                type="button"
                onClick={() => {
                  onChange(value.filter((v) => v.slug !== x.slug));
                  search.current?.focus();
                }}
                aria-label={t('tagRemove', { name: label(x) })}
                className="press inline-flex min-h-11 items-center gap-1.5 rounded-full bg-navy px-3.5 text-sm font-bold text-white focus-visible:outline-3 focus-visible:outline-focus"
              >
                {label(x)}
                <UstaadIcon name="close" size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <label htmlFor={inputId} className="sr-only">
        {t('tagSearch')}
      </label>
      <input
        id={inputId}
        ref={search}
        type="search"
        value={q}
        placeholder={t('tagSearch')}
        onChange={(e) => {
          setQ(e.target.value);
        }}
        className={fieldClass}
      />
      {full ? <p className="text-sm text-muted">{t('tagsMax')}</p> : null}
      <ul className="flex flex-wrap gap-2">
        {found
          .filter((x) => !value.some((v) => v.slug === x.slug))
          .map((x) => (
            <li key={x.slug}>
              <button
                type="button"
                aria-disabled={full}
                onClick={() => {
                  if (full) return;
                  onChange([...value, x]);
                  search.current?.focus();
                }}
                aria-label={t('tagAdd', { name: label(x) })}
                className="press inline-flex min-h-11 items-center rounded-full bg-pill px-3.5 text-sm font-bold text-ink hover:bg-accent-soft aria-disabled:opacity-50 focus-visible:outline-3 focus-visible:outline-focus"
              >
                {label(x)}
              </button>
            </li>
          ))}
      </ul>
      <p role="status" className="text-sm text-muted empty:sr-only">
        {q.trim() && found.length === 0 ? t('tagsNone') : ''}
      </p>
    </fieldset>
  );
}

/**
 * Create a post or a story (spec 23 § 4 flows 4 and 6; founder: voice first, two taps on the fast path): pick what to
 * share (big tiles with icons and words), add it with the shared media parts (hold-to-talk recorder, photo picker that
 * strips the place details, video and PDF pickers that show the size), words with smart correction, up to 5 curated
 * tags, then one primary button. Files upload with progress before the post is sent; the idempotency key is kept
 * across retries; API refusals (daily cap, links too early, unknown tag…) are shown in words.
 */
export function Composer({ story }: { story: boolean }) {
  const t = useTranslations('ustaad.feed');
  const locale = useLocale();
  const client = useSocialAction();
  const errorText = useSocialError('feed');
  const [choice, setChoice] = useState<Choice | null>(story ? 'photo' : null);
  const [body, setBody] = useState('');
  const [meta, setMeta] = useState<CorrectionMeta>({ correction: 'none', original: null });
  const [fix, setFix] = useState({ symptom: '', cause: '', fix: '' });
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [voice, setVoice] = useState<Recording | null>(null);
  const [video, setVideo] = useState<{ file: File; durationMs: number } | null>(null);
  const [doc, setDoc] = useState<File | null>(null);
  const [options, setOptions] = useState(['', '']);
  const [linkUrl, setLinkUrl] = useState('');
  const [tags, setTags] = useState<TagListItem[]>([]);
  const [storyKind, setStoryKind] = useState<'photo' | 'voice' | 'video'>('photo');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The field an error is about (aria-invalid + focus), when there is one. */
  const [errField, setErrField] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; held: boolean } | null>(null);
  const [sample, setSample] = useState(false);
  const idem = useRef(`p${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const ids = { body: useId(), photos: useId(), video: useId(), doc: useId(), link: useId(), err: useId() };

  useEffect(() => {
    heading.current?.focus();
    void client().then((c) => {
      setSample(c.sample);
    });
  }, [client]);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);
  const photoUrls = useRef<string[]>([]);
  photoUrls.current = photos.map((p) => p.url);
  useEffect(
    () => () => {
      // Leaving the screen: free the previews still shown (removed ones were freed on removal).
      for (const url of photoUrls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const kind: ComposerKind | null = choice ? kindOf(choice) : null;
  const template = choice === 'fix_log' || choice === 'tip' || choice === 'before_after' ? choice : undefined;
  const effectiveStory = story ? storyKind : null;
  const wantsPhotos = effectiveStory ? effectiveStory === 'photo' : kind === 'photo';
  const wantsVoice = effectiveStory ? effectiveStory === 'voice' : kind === 'voice';
  const wantsVideo = effectiveStory ? effectiveStory === 'video' : kind === 'video';
  const maxPhotos = story ? 1 : template === 'before_after' ? 2 : MAX_PHOTOS;

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    const room = maxPhotos - photos.length;
    const picked: Photo[] = [];
    for (const f of [...files].slice(0, Math.max(0, room))) {
      try {
        const img = await prepareImage(f);
        picked.push({
          ...img,
          url: URL.createObjectURL(img.blob),
          role: photos.length + picked.length === 0 ? 'before' : 'after',
        });
      } catch {
        setError(t('err_media_required'));
      }
    }
    setPhotos((xs) => [...xs, ...picked]);
  }

  async function upload(file: Blob, declare: MediaDeclare): Promise<string | null> {
    if (file.size > SINGLE_PUT_BYTES) {
      setError(errorText('MEDIA_TOO_LARGE'));
      return null;
    }
    setProgress(0);
    const up = await (await ustaadClient(locale)).upload(file, declare, setProgress);
    setProgress(null);
    if (!up.ok) {
      setError(errorText(up.code));
      return null;
    }
    return up.data.mediaId;
  }

  async function submit() {
    if (busy || (!story && !choice)) return;
    setError(null);
    setErrField(null);
    setBusy(true);
    try {
      const media: { mediaId: string; role?: 'before' | 'after' }[] = [];
      if (wantsPhotos)
        for (const p of photos) {
          const id = await upload(p.blob, { kind: 'image', mime: p.mime, width: p.width, height: p.height });
          if (!id) return;
          media.push(template === 'before_after' ? { mediaId: id, role: p.role } : { mediaId: id });
        }
      if (wantsVoice && voice) {
        const id = await upload(voice.blob, {
          kind: 'audio',
          mime: voice.mime,
          durationMs: voice.durationMs,
        });
        if (!id) return;
        media.push({ mediaId: id });
      }
      if (wantsVideo && video) {
        const id = await upload(video.file, {
          kind: 'video',
          mime: video.file.type,
          durationMs: video.durationMs,
        });
        if (!id) return;
        media.push({ mediaId: id });
      }
      if (kind === 'document' && doc) {
        const id = await upload(doc, { kind: 'document', mime: 'application/pdf' });
        if (!id) return;
        media.push({ mediaId: id });
      }
      const c = await client();
      if (story) {
        const first = media[0];
        if (!first) {
          setError(t('err_media_required'));
          return;
        }
        const caption = body.trim();
        const r = await c.addStory({
          mediaId: first.mediaId,
          ...(caption ? { body: caption.slice(0, 200) } : {}),
          idemKey: idem.current,
        });
        if (!r.ok) {
          setError(errorText(r.code));
          return;
        }
        setDone({ id: r.data.id, held: r.data.status === 'held' });
        return;
      }
      let text = body.trim();
      let m = meta;
      if (text && m.correction === 'none') {
        const fixed = await correctForSend(locale, text);
        text = fixed.text;
        m = fixed.meta;
      }
      const draft: PostDraft = {
        kind: kind ?? 'text',
        ...(template ? { template } : {}),
        body: text,
        ...(m.original ? { bodyOriginal: m.original.slice(0, 3000) } : {}),
        correction: m.correction,
        fixSymptom: fix.symptom,
        fixCause: fix.cause,
        fixFix: fix.fix,
        media,
        pollOptions: options,
        linkUrl,
        tags: tags.map((x) => x.slug),
      };
      const built = buildPostInput(draft, idem.current);
      if (!built.ok) {
        setError(t(`err_${built.error}`));
        const target =
          built.error === 'body_required'
            ? ids.body
            : built.error === 'link_invalid'
              ? ids.link
              : built.error === 'fix_required'
                ? 'fix-symptom'
                : built.error === 'poll_options'
                  ? 'poll-0'
                  : null;
        setErrField(target);
        if (target) window.setTimeout(() => document.getElementById(target)?.focus(), 0);
        return;
      }
      const r = await c.createPost(built.input);
      if (!r.ok) {
        setError(errorText(r.code));
        return;
      }
      setDone({ id: r.data.id, held: r.data.status === 'held' });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const tile = (c: Choice, icon: UstaadIconName, label: string) => (
    <button
      key={c}
      type="button"
      aria-pressed={choice === c}
      onClick={() => {
        setChoice(c);
        setError(null);
        if (c === 'before_after') setPhotos((xs) => xs.slice(0, 2));
      }}
      className={`press flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-2xl border px-2 text-center text-[14px] font-bold focus-visible:outline-3 focus-visible:outline-focus ${choice === c ? 'border-accent bg-accent-soft text-accent-soft-text' : 'border-line-card bg-surface text-ink hover:border-accent'}`}
    >
      <UstaadIcon name={icon} size={26} />
      {label}
    </button>
  );

  return (
    <section aria-labelledby="ustaad-create-title" className={`${card} mx-auto grid w-full max-w-2xl gap-5`}>
      <header className="flex items-center justify-between gap-3">
        <h1
          id="ustaad-create-title"
          ref={heading}
          tabIndex={-1}
          className="font-heading text-[clamp(22px,4.6vw,28px)] font-extrabold text-ink focus-visible:outline-3 focus-visible:outline-focus"
        >
          {story ? t('createStoryTitle') : t('createTitle')}
        </h1>
        <Link
          href={localePath('/ustaad', locale)}
          aria-label={t('close')}
          className="press inline-flex size-12 items-center justify-center rounded-full bg-pill text-ink hover:bg-line focus-visible:outline-3 focus-visible:outline-focus"
        >
          <UstaadIcon name="close" />
        </Link>
      </header>
      <SampleNote show={sample} />

      {done ? (
        <div
          ref={doneRef}
          tabIndex={-1}
          className="grid justify-items-center gap-3 text-center focus-visible:outline-3 focus-visible:outline-focus"
        >
          <span className="flex size-14 items-center justify-center rounded-full bg-success-bg text-success">
            <UstaadIcon name="check" size={30} />
          </span>
          <p className="text-[17px] font-bold text-ink">{done.held ? t('postedHeld') : t('posted')}</p>
          <div className="flex flex-wrap justify-center gap-3">
            {!story ? (
              <Link href={localePath(`/ustaad/p/${done.id}`, locale)} className={btnPrimary}>
                {t('viewPost')}
              </Link>
            ) : null}
            <Link href={localePath('/ustaad', locale)} className={btnQuiet}>
              {t('backHome')}
            </Link>
          </div>
        </div>
      ) : (
        <form
          className="grid gap-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {story ? (
            <fieldset className="grid gap-2">
              <legend className="font-heading text-base font-extrabold text-ink">{t('kindTitle')}</legend>
              <p className="text-sm text-muted">{t('storyGone')}</p>
              <div className="grid grid-cols-3 gap-2">
                {(['photo', 'voice', 'video'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={storyKind === k}
                    onClick={() => {
                      setStoryKind(k);
                    }}
                    className={`press flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-2xl border text-[14px] font-bold focus-visible:outline-3 focus-visible:outline-focus ${storyKind === k ? 'border-accent bg-accent-soft text-accent-soft-text' : 'border-line-card bg-surface text-ink'}`}
                  >
                    <UstaadIcon name={k === 'photo' ? 'photo' : k === 'voice' ? 'mic' : 'video'} size={26} />
                    {t(`kind_${k}`)}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : (
            <>
              <fieldset className="grid gap-2">
                <legend className="font-heading text-base font-extrabold text-ink">{t('kindTitle')}</legend>
                <div className="grid grid-cols-3 gap-2 min-[520px]:grid-cols-4">
                  {KIND_TILES.map((k) => tile(k.choice, k.icon, t(`kind_${k.choice as 'voice'}`)))}
                </div>
              </fieldset>
              <fieldset className="grid gap-2">
                <legend className="font-heading text-base font-extrabold text-ink">{t('quickTitle')}</legend>
                <div className="grid grid-cols-3 gap-2">
                  {QUICK.map((k) => tile(k.choice, k.icon, t(`tpl_${k.choice as 'tip'}`)))}
                </div>
                <Link
                  href={localePath('/ustaad/ask/new', locale)}
                  className="mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-bold text-accent-soft-text hover:underline focus-visible:outline-3 focus-visible:outline-focus"
                >
                  <UstaadIcon name="mic" size={18} />
                  {t('askInstead')}
                </Link>
              </fieldset>
            </>
          )}

          {wantsVoice ? (
            <VoiceRecorder maxSeconds={VOICE_MAX_S} onChange={setVoice} label={t('kind_voice')} hint="" />
          ) : null}

          {wantsPhotos ? (
            <div className="grid gap-2">
              <p className="text-sm text-muted">{t('photosHint')}</p>
              {photos.length > 0 ? (
                <ul className="grid grid-cols-3 gap-2">
                  {photos.map((p, i) => (
                    <li key={p.url} className="grid gap-1">
                      <Image
                        unoptimized
                        src={p.url}
                        alt={t('photoN', { n: i + 1 })}
                        width={p.width}
                        height={p.height}
                        className="aspect-square w-full rounded-xl object-cover"
                      />
                      {template === 'before_after' ? (
                        <label className="grid gap-1 text-xs font-bold text-ink">
                          {t('roleLabel', { n: i + 1 })}
                          <select
                            value={p.role}
                            onChange={(e) => {
                              const role = e.target.value === 'before' ? 'before' : 'after';
                              setPhotos((xs) => xs.map((x, j) => (j === i ? { ...x, role } : x)));
                            }}
                            className={`${fieldClass} min-h-11 py-1 text-sm`}
                          >
                            <option value="before">{t('before')}</option>
                            <option value="after">{t('after')}</option>
                          </select>
                        </label>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          URL.revokeObjectURL(p.url);
                          setPhotos((xs) => xs.filter((_, j) => j !== i));
                          // The pressed button is gone: focus the photo picker (always shown below a removal).
                          window.setTimeout(() => document.getElementById(ids.photos)?.focus(), 0);
                        }}
                        className="press inline-flex min-h-11 items-center justify-center rounded-lg text-sm font-bold text-error focus-visible:outline-3 focus-visible:outline-focus"
                      >
                        {t('removePhoto', { n: i + 1 })}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {photos.length < maxPhotos ? (
                <label htmlFor={ids.photos} className={`${btnQuiet} file-pick cursor-pointer`}>
                  <UstaadIcon name="photo" />
                  {t('addPhoto')}
                  <input
                    id={ids.photos}
                    type="file"
                    accept="image/*"
                    multiple={maxPhotos > 1}
                    className="sr-only"
                    onChange={(e) => {
                      void addPhotos(e.target.files);
                      e.target.value = '';
                    }}
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          {wantsVideo ? (
            <div className="grid gap-2">
              <p className="text-sm text-muted">{t('videoHint')}</p>
              <label htmlFor={ids.video} className={`${btnQuiet} file-pick cursor-pointer`}>
                <UstaadIcon name="video" />
                {t('videoPick')}
                <input
                  id={ids.video}
                  type="file"
                  accept="video/mp4,video/webm"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f)
                      void videoDuration(f).then((ms) => {
                        setVideo({ file: f, durationMs: ms });
                      });
                  }}
                />
              </label>
              {video ? (
                <p className="text-sm font-bold text-ink">
                  {t('videoChosen', {
                    time: durationLabel(video.durationMs),
                    size: sizeLabel(video.file.size),
                  })}
                </p>
              ) : null}
            </div>
          ) : null}

          {kind === 'document' ? (
            <div className="grid gap-2">
              <label htmlFor={ids.doc} className={`${btnQuiet} file-pick cursor-pointer`}>
                <UstaadIcon name="doc" />
                {t('docPick')}
                <input
                  id={ids.doc}
                  type="file"
                  accept="application/pdf"
                  className="sr-only"
                  onChange={(e) => {
                    setDoc(e.target.files?.[0] ?? null);
                  }}
                />
              </label>
              {doc ? (
                <p className="text-sm font-bold text-ink">{t('docChosen', { size: sizeLabel(doc.size) })}</p>
              ) : null}
            </div>
          ) : null}

          {template === 'fix_log' ? (
            <div className="grid gap-3">
              {(['symptom', 'cause', 'fix'] as const).map((k) => (
                <label key={k} className="grid gap-1.5 text-[15px] font-bold text-ink">
                  {t(k === 'symptom' ? 'fixSymptom' : k === 'cause' ? 'fixCause' : 'fixFix')}
                  <textarea
                    id={`fix-${k}`}
                    required={k !== 'cause'}
                    aria-invalid={errField === `fix-${k}` ? true : undefined}
                    aria-describedby={errField === `fix-${k}` ? ids.err : undefined}
                    value={fix[k]}
                    rows={2}
                    maxLength={500}
                    onChange={(e) => {
                      setFix((f) => ({ ...f, [k]: e.target.value }));
                    }}
                    className={`${fieldClass} min-h-16 font-normal`}
                  />
                </label>
              ))}
            </div>
          ) : null}

          {choice || story ? (
            <div className="grid gap-1.5">
              <label htmlFor={ids.body} className="text-[15px] font-bold text-ink">
                {story
                  ? t('captionLabel')
                  : kind === 'poll'
                    ? t('pollQuestion')
                    : template === 'tip'
                      ? t('tipLabel')
                      : t('bodyLabel')}
              </label>
              <textarea
                id={ids.body}
                ref={bodyRef}
                aria-invalid={errField === ids.body ? true : undefined}
                aria-describedby={errField === ids.body ? ids.err : undefined}
                value={body}
                rows={story ? 1 : 3}
                maxLength={story ? 200 : 3000}
                onChange={(e) => {
                  setBody(e.target.value);
                  setMeta({ correction: 'none', original: null });
                }}
                className={`${fieldClass} ${story ? 'min-h-12' : 'min-h-24'}`}
              />
              {!story ? (
                <SmartCorrection
                  value={body}
                  fieldRef={bodyRef}
                  onChange={(text, m) => {
                    setBody(text);
                    setMeta(m);
                  }}
                />
              ) : null}
            </div>
          ) : null}

          {kind === 'poll' && !story ? (
            <div className="grid gap-2">
              {options.map((o, i) => (
                <label key={i} className="grid gap-1 text-[15px] font-bold text-ink">
                  {t('pollOption', { n: i + 1 })}
                  <input
                    id={`poll-${String(i)}`}
                    required={i < 2}
                    aria-invalid={errField === `poll-${String(i)}` ? true : undefined}
                    aria-describedby={errField === `poll-${String(i)}` ? ids.err : undefined}
                    value={o}
                    maxLength={80}
                    onChange={(e) => {
                      setOptions((xs) => xs.map((x, j) => (j === i ? e.target.value : x)));
                    }}
                    className={`${fieldClass} font-normal`}
                  />
                </label>
              ))}
              {options.length < 4 ? (
                <button
                  type="button"
                  className={`${btnQuiet} justify-self-start`}
                  onClick={() => {
                    setOptions((xs) => [...xs, '']);
                  }}
                >
                  <UstaadIcon name="plus" />
                  {t('addOption')}
                </button>
              ) : null}
            </div>
          ) : null}

          {kind === 'link' && !story ? (
            <div className="grid gap-1.5">
              <label htmlFor={ids.link} className="text-[15px] font-bold text-ink">
                {t('linkLabel')}
              </label>
              <input
                id={ids.link}
                required
                aria-invalid={errField === ids.link ? true : undefined}
                aria-describedby={errField === ids.link ? ids.err : undefined}
                type="url"
                inputMode="url"
                value={linkUrl}
                onChange={(e) => {
                  setLinkUrl(e.target.value);
                }}
                className={fieldClass}
              />
            </div>
          ) : null}

          {choice && !story ? <TagPicker value={tags} onChange={setTags} /> : null}

          {progress !== null ? <UploadProgress pct={progress} /> : null}
          <p role="status" className="sr-only">
            {busy ? t('posting') : wantsPhotos && photos.length > 0 ? t('photoN', { n: photos.length }) : ''}
          </p>
          <p id={ids.err} role="alert" className="text-[15px] font-bold text-error empty:sr-only">
            {error}
          </p>
          {choice || story ? (
            <button type="submit" aria-disabled={busy} className={`${btnPrimary} w-full`}>
              <UstaadIcon name="send" />
              {busy ? t('posting') : story ? t('postStory') : t('post')}
            </button>
          ) : null}
        </form>
      )}
    </section>
  );
}
