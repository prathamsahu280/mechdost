import type { JOB_ROLES } from '@mechdost/shared/ustaad/codes';
import type { Choices, ChoicesView, MemberView } from '@mechdost/shared/ustaad/dto/members';
import type { StandingView } from '@mechdost/shared/ustaad/dto/moderation';
import type {
  AnswerInput,
  AskQuestion,
  LearnProgress,
  LearnView,
  QuestionCard,
  QuestionDetail,
  QuestionFilter,
} from '@mechdost/shared/ustaad/dto/qa';
import type { ApplicantView, LocationBody, PostJobBody } from '@mechdost/shared/ustaad/dto/local';
import type { SaveCollection, SavedPage, SavedSummary } from '@mechdost/shared/ustaad/dto/saved';
import type { UstaadSaveKind } from '@mechdost/shared/ustaad/saved';
import { AUTH_MODE } from '../auth/mode';
import type { ApiResult } from '../orders-api';
import type { Banded } from './local-view';

/**
 * One seam for every Ustaad C + E screen (Q&A, Learn, pin, area, jobs). Real sign-in builds call the API
 * (`api-client.ts`, every answer checked with the shared schemas); the browser demo (staff preview without an API) loads
 * labelled sample data (`demo/ustaad.ts`). Both are loaded on demand, so storefront bundles never carry either.
 */

export type { ApplicantView, StandingView };
export type JobRole = (typeof JOB_ROLES)[number];

export interface MyLocation {
  lat: number;
  lng: number;
  accuracyM: number;
  source: 'gps' | 'manual';
  landmark: string | null;
  useForVerify: boolean;
  countInZone: boolean;
  shareExact: boolean;
  exactAudience: 'connections' | 'all_verified';
  hidden: boolean;
  verified: boolean;
  confirmedAt: string;
}

export interface Zone {
  zoneCell: string;
  center: { lat: number; lng: number };
  total: Banded;
  segments: Record<string, Banded>;
}

export interface Job {
  id: string;
  code: string;
  roleCode: JobRole;
  title: string;
  description: string;
  areaLabel: string;
  areaLabelHi: string | null;
  cityCode: string;
  payMinPaiseMonth: number;
  payMaxPaiseMonth: number;
  timing: string;
  experienceMinYears: number;
  segmentCodes: string[];
  status: string;
  mine: boolean;
  /** Spec 23 § 21i-L: the viewer's save flag and the business behind the job (name and verified mark only). */
  savedByMe: boolean;
  employer: { name: string; nameHi: string | null; verified: boolean } | null;
  underReview: boolean;
  expiresAt: string;
  createdAt: string;
}

export interface MediaDeclare {
  /** Video and PDF come from the feed composer (workstream D web); single PUT only (≤ 16 MB) until multipart lands. */
  kind: 'image' | 'audio' | 'video' | 'document';
  mime: string;
  durationMs?: number;
  width?: number;
  height?: number;
  /** Author's typed summary of a voice note or video (spec 23 § 10a). */
  summary?: string;
  /** Video only: typed captions ("0:05 — text" lines or one block) and their language. */
  captions?: { lang: 'hi' | 'en'; text: string };
}

export type AskInput = Omit<AskQuestion, 'correction' | 'reach' | 'hideGarage'> & {
  correction?: AskQuestion['correction'];
};
export type AnswerBody = Omit<AnswerInput, 'correction'> & { correction?: AnswerInput['correction'] };
export type PostJobInput = Omit<
  PostJobBody,
  'areaLabelHi' | 'experienceMinYears' | 'segmentCodes' | 'idemKey'
> &
  Partial<Pick<PostJobBody, 'areaLabelHi' | 'experienceMinYears' | 'segmentCodes' | 'idemKey'>>;
export type LocationInput = Omit<LocationBody, 'landmark' | 'mockSuspected' | 'exactAudience' | 'hidden'> &
  Partial<Pick<LocationBody, 'landmark' | 'mockSuspected' | 'exactAudience' | 'hidden'>>;

/** The Saved list's filters (spec 23 § 21i): all optional, `q` is the word search over the saved text. */
export interface SavedFilter {
  kind?: UstaadSaveKind;
  collectionId?: string;
  q?: string;
  cursor?: string;
}

export interface UstaadClient {
  /** True for the browser demo: screens show the "sample data" note. */
  readonly sample: boolean;
  me(): Promise<ApiResult<{ member: MemberView | null; staffPreview: boolean }>>;
  questions(
    filter: QuestionFilter,
    cursor: string | null,
  ): Promise<ApiResult<{ items: QuestionCard[]; nextCursor: string | null }>>;
  question(code: string): Promise<ApiResult<QuestionDetail>>;
  ask(input: AskInput): Promise<ApiResult<{ code: string }>>;
  answer(code: string, input: AnswerBody): Promise<ApiResult<{ id: string }>>;
  helpful(answerId: string): Promise<ApiResult<{ helpfulCount: number; voted: boolean }>>;
  best(code: string, answerId: string): Promise<ApiResult<{ status: 'solved' }>>;
  learn(): Promise<ApiResult<LearnView>>;
  progress(
    resourceId: string,
    body: LearnProgress,
  ): Promise<ApiResult<{ watchedSeconds: number; completed: boolean }>>;
  myLocation(): Promise<ApiResult<MyLocation | null>>;
  saveLocation(input: LocationInput): Promise<ApiResult<MyLocation>>;
  signboard(mediaId: string): Promise<ApiResult<{ ok: true }>>;
  zones(): Promise<ApiResult<Zone[]>>;
  jobs(
    role: JobRole | null,
    cursor: string | null,
  ): Promise<ApiResult<{ items: Job[]; next: string | null }>>;
  job(code: string): Promise<ApiResult<Job>>;
  postJob(input: PostJobInput): Promise<ApiResult<Job>>;
  apply(
    code: string,
    body: { sharePhone: boolean; voiceIntroMediaId: string | null },
  ): Promise<ApiResult<{ applicationId: string; status: string }>>;
  moveJob(
    code: string,
    action: 'pause' | 'resume' | 'close' | 'fill',
  ): Promise<ApiResult<{ status: string }>>;
  /** My choices and consents (SIM-P10 voice consent, G17 smart-correction mode). */
  choices(): Promise<ApiResult<ChoicesView>>;
  saveChoices(body: Choices): Promise<ApiResult<ChoicesView>>;
  /** My standing (SIM-P19/P27): readable while banned or restricted. */
  standing(): Promise<ApiResult<StandingView>>;
  /** Appeal one decision (a support ticket of kind ustaad_appeal). */
  fileAppeal(
    reportCode: string,
    note: string,
  ): Promise<ApiResult<{ ticketCode: string; reportCode: string }>>;
  /** The employer's applicants of one job (SIM-P18); 404 for anyone else. */
  applicants(
    code: string,
    cursor: string | null,
  ): Promise<ApiResult<{ items: ApplicantView[]; next: string | null }>>;
  /** Employer: seen / shortlist / reject / hire one application. */
  moveApplication(
    applicationId: string,
    action: 'seen' | 'shortlist' | 'reject' | 'hire',
  ): Promise<ApiResult<{ status: string }>>;
  /** Declare → upload (progress 0–100) → verify; resolves with the media id once the API accepted the file. */
  upload(
    file: Blob,
    meta: MediaDeclare,
    onProgress: (pct: number) => void,
  ): Promise<ApiResult<{ mediaId: string }>>;
  /** A short-lived signed URL to play or show a media object (≤ 10 minutes). */
  mediaUrl(mediaId: string): Promise<ApiResult<{ url: string }>>;
  /** Saved (spec 23 § 21i): my saved items of every kind, newest save first. */
  savedList(filter: SavedFilter): Promise<ApiResult<SavedPage>>;
  savedSummary(): Promise<ApiResult<SavedSummary>>;
  setSaved(kind: UstaadSaveKind, id: string, on: boolean): Promise<ApiResult<{ saved: boolean }>>;
  createCollection(name: string): Promise<ApiResult<SaveCollection>>;
  renameCollection(id: string, name: string, version: number): Promise<ApiResult<SaveCollection>>;
  deleteCollection(id: string): Promise<ApiResult<null>>;
  setInCollection(
    id: string,
    target: { kind: UstaadSaveKind; id: string },
    on: boolean,
  ): Promise<ApiResult<null>>;
}

const cache = new Map<string, Promise<UstaadClient>>();

export function ustaadClient(locale: string): Promise<UstaadClient> {
  let c = cache.get(locale);
  if (!c) {
    c =
      AUTH_MODE === 'firebase'
        ? import('./api-client').then((m) => m.apiUstaadClient(locale))
        : import('@/demo/ustaad').then((m) => m.demoUstaadClient());
    cache.set(locale, c);
    // A failed chunk load is not cached: the next screen (or Try again) loads it afresh.
    void c.catch(() => cache.delete(locale));
  }
  return c;
}
