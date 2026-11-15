import type { WhatsAppTemplateKey } from '@mechdost/shared/whatsapp';

/**
 * View helpers for Admin → Notifications in real sign-in builds (spec 10; Stream D 2026-11-14). The API stores one
 * WhatsApp template per event and language (`GET /v1/admin/notifications/templates`); "on" for an event means its
 * templates are enabled. The screen edits both languages together, so it saves each language's row with that
 * row's own version (null = create).
 */
export type NotifyLocale = 'en' | 'hi';

export interface TemplateRow {
  key: string;
  channel: string;
  locale: NotifyLocale;
  body: string;
  enabled: boolean;
  version: number;
}

export interface EventView {
  enabled: boolean;
  body: Record<NotifyLocale, string>;
  /** Row version per language; null = no row yet (first save creates it). */
  version: Record<NotifyLocale, number | null>;
  /** True when no saved text exists for a language (the locale-file default is shown). */
  usesDefault: Record<NotifyLocale, boolean>;
}

/** The WhatsApp rows of one event, defaults where nothing is saved. On = any language enabled. */
export function eventView(
  rows: readonly TemplateRow[],
  event: WhatsAppTemplateKey,
  defaults: Record<NotifyLocale, string>,
): EventView {
  const row = (locale: NotifyLocale) =>
    rows.find((r) => r.key === event && r.channel === 'whatsapp' && r.locale === locale);
  const en = row('en');
  const hi = row('hi');
  return {
    enabled: (en?.enabled ?? false) || (hi?.enabled ?? false),
    body: { en: en?.body ?? defaults.en, hi: hi?.body ?? defaults.hi },
    version: { en: en?.version ?? null, hi: hi?.version ?? null },
    usesDefault: { en: !en, hi: !hi },
  };
}

/** The PUT bodies for one event (both languages, same switch). */
export function templateSaves(
  event: WhatsAppTemplateKey,
  view: Pick<EventView, 'version'>,
  draft: { enabled: boolean; body: Record<NotifyLocale, string> },
) {
  return (['en', 'hi'] as const).map((locale) => ({
    key: event,
    channel: 'whatsapp' as const,
    locale,
    body: draft.body[locale].trim(),
    enabled: draft.enabled,
    version: view.version[locale],
  }));
}

const META_STATUS_LABEL = {
  approved: 'notify_meta_approved',
  pending: 'notify_meta_pending',
  rejected: 'notify_meta_rejected',
  paused: 'notify_meta_paused',
  disabled: 'notify_meta_disabled',
  missing: 'notify_meta_missing',
  unknown: 'notify_meta_unknown',
} as const;

/** Meta's review status of a template → the locale key shown in the card (`portal.notify_meta_*`). */
export function metaStatusLabel(
  status: string,
): (typeof META_STATUS_LABEL)[keyof typeof META_STATUS_LABEL] | 'notify_meta_other' {
  return Object.hasOwn(META_STATUS_LABEL, status)
    ? META_STATUS_LABEL[status as keyof typeof META_STATUS_LABEL]
    : 'notify_meta_other';
}

export type SaveProblem = 'empty' | 'promo_wording' | 'missing' | 'too_long' | 'stale' | null;

/** API template codes → the editor's field messages (`portal.notify_problem_*`); null = not a field problem. */
export function templateErrorProblem(code: string): SaveProblem {
  switch (code) {
    case 'TEMPLATE_EMPTY':
      return 'empty';
    case 'TEMPLATE_PROMO_WORDING':
      return 'promo_wording';
    case 'TEMPLATE_PLACEHOLDERS':
      return 'missing';
    case 'TEMPLATE_TOO_LONG':
      return 'too_long';
    case 'STALE_TEMPLATE':
    case 'CONFLICT':
      return 'stale';
    default:
      return null;
  }
}

/** Whole rupees typed for the budget → paise, or null when it is not a whole number within the limits. */
export function budgetPaiseFrom(raw: string, limits: readonly [number, number]): number | null {
  const text = raw.trim();
  if (!/^\d{1,9}$/.test(text)) return null;
  const paise = Number(text) * 100;
  return paise < limits[0] || paise > limits[1] ? null : paise;
}
