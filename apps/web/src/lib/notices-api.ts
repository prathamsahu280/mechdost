import {
  NoticeCountDto,
  NoticePageDto,
  NoticePreferencesViewDto,
  NoticeReadResultDto,
  PushDeviceDto,
  PushDeviceRemovedDto,
  type NoticePage,
  type NoticePreferences,
  type NoticePreferencesView,
} from '@mechdost/shared/notice-api';
import { authed, type ApiResult } from './orders-api';

/**
 * The bell, the push device and the notification choices on the API (design 2026-11-15; spec 10). Answers are validated
 * with the shared schemas; the API is the only copy. This file never imports the notice texts or the Firebase push
 * library, so the bell chunk stays small (spec 16).
 */
export function fetchNotices(
  locale: string,
  opts: { cursor?: string; limit?: number } = {},
): Promise<ApiResult<NoticePage>> {
  const q = new URLSearchParams();
  if (opts.limit) q.set('limit', String(opts.limit));
  if (opts.cursor) q.set('cursor', opts.cursor);
  const qs = q.toString();
  return authed(locale, `/me/notifications${qs ? `?${qs}` : ''}`, NoticePageDto);
}

export const fetchUnreadCount = (locale: string) =>
  authed(locale, '/me/notifications/unread-count', NoticeCountDto);

export const markNoticesRead = (locale: string, which: { ids: string[] } | { all: true }) =>
  authed(locale, '/me/notifications/read', NoticeReadResultDto, { method: 'POST', body: which });

export const registerPushDevice = (locale: string, token: string) =>
  authed(locale, '/me/push-devices', PushDeviceDto, {
    method: 'POST',
    body: { token, locale: locale === 'hi' ? 'hi' : 'en' },
  });

export const removePushDevice = (locale: string, id: string) =>
  authed(locale, `/me/push-devices/${encodeURIComponent(id)}`, PushDeviceRemovedDto, { method: 'DELETE' });

export const fetchNoticePreferences = (locale: string): Promise<ApiResult<NoticePreferencesView>> =>
  authed(locale, '/me/notification-preferences', NoticePreferencesViewDto);

export const saveNoticePreferences = (
  locale: string,
  change: Partial<NoticePreferences>,
): Promise<ApiResult<NoticePreferencesView>> =>
  authed(locale, '/me/notification-preferences', NoticePreferencesViewDto, { method: 'PATCH', body: change });
