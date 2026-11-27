import {
  MyCardDto,
  OnboardingViewDto,
  SignedMediaUrlDto,
  TutorialDto,
  VerificationStatusDto,
  type MyCard,
  type OnboardingEvent,
  type OnboardingView,
  type Tutorial,
  type VerificationView,
} from '@mechdost/shared/ustaad/dto/verification';
import { authed, type ApiResult } from '../orders-api';

/**
 * Ustaad identity calls from the browser (spec 23 § 8): my card, the tutorial and its progress, verification status.
 * Answers are checked with the shared schemas (hard rule 4). Loaded with `import()` from the client islands.
 */
export const fetchMyCard = (locale: string): Promise<ApiResult<MyCard>> =>
  authed(locale, `/ustaad/me/card?lang=${locale === 'en' ? 'en' : 'hi'}`, MyCardDto);

export const fetchTutorial = (locale: string): Promise<ApiResult<Tutorial>> =>
  authed(locale, `/ustaad/tutorial?lang=${locale === 'en' ? 'en' : 'hi'}`, TutorialDto);

export const fetchOnboarding = (locale: string): Promise<ApiResult<OnboardingView>> =>
  authed(locale, '/ustaad/onboarding', OnboardingViewDto);

export const saveOnboarding = (locale: string, event: OnboardingEvent): Promise<ApiResult<OnboardingView>> =>
  authed(locale, '/ustaad/onboarding', OnboardingViewDto, { method: 'PUT', body: event });

export const resetOnboarding = (locale: string): Promise<ApiResult<OnboardingView>> =>
  authed(locale, '/ustaad/onboarding/reset', OnboardingViewDto, { method: 'POST' });

export const fetchVerificationStatus = (
  locale: string,
): Promise<ApiResult<{ verification: VerificationView | null }>> =>
  authed(locale, '/ustaad/verification-status', VerificationStatusDto);

/** A short-lived signed URL for a narration recording (≤ 10 min). */
export const fetchMediaUrl = (locale: string, mediaId: string): Promise<ApiResult<{ url: string }>> =>
  authed(locale, `/ustaad/media/${encodeURIComponent(mediaId)}/url`, SignedMediaUrlDto);
