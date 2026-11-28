'use client';

import {
  ServiceRequestPageDto,
  WorkshopProfilesDto,
  WorkshopSlotsDto,
  type ServiceRequestSummary,
} from '@mechdost/shared/service-api';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { adminApi } from '@/lib/admin-api';
import { LocalLink } from '@/components/ui/local-link';
import { requestStatusKey } from '@/lib/service-views';
import {
  agendaFor,
  agendaWithCapacity,
  calendarDays,
  combineSlots,
  dayCounts,
  hourText,
  pickDay,
  type HourSlot,
} from '@/lib/workshop-calendar';
import { ApiListState } from './api-list-state';
import { portalCard, portalQuiet } from './portal-styles';
import { useApiList } from './use-api-list';
import { useNow } from './use-now';

const POLL_MS = 60_000;
/** The strip only needs the live jobs; a workshop has a few dozen at most, so a handful of pages is plenty. */
const MAX_AUTO_PAGES = 10;

const dateLocale = (locale: string) => (locale === 'hi' ? 'hi-IN' : 'en-IN');

/** An IST calendar date (`YYYY-MM-DD`) written for display; the date is already IST, so it is formatted as UTC. */
function dayText(day: string, locale: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(dateLocale(locale), { ...opts, timeZone: 'UTC' }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

/**
 * Free places per open hour of one IST day, added up over the owner's workshops (the same ones the agenda lists).
 * Reads the existing `GET /workshop/profile` (the workshop ids) and `GET /workshop/slots` (the proposal form's hour
 * picker reads the same route); both are scoped to the signed-in owner by the API. A failure shows no capacity line.
 */
function useDayCapacity(locale: string, day: string): HourSlot[] {
  const [ids, setIds] = useState<string[]>([]);
  const [slots, setSlots] = useState<{ day: string; rows: HourSlot[] } | null>(null);
  useEffect(() => {
    let live = true;
    void adminApi(locale, '/workshop/profile', WorkshopProfilesDto).then((res) => {
      if (live && res.ok) setIds(res.data.workshops.map((w) => w.workshopId));
    });
    return () => {
      live = false;
    };
  }, [locale]);
  useEffect(() => {
    if (ids.length === 0) return;
    let live = true;
    void Promise.all(
      ids.map((id) =>
        adminApi(
          locale,
          `/workshop/slots?workshopId=${encodeURIComponent(id)}&date=${day}`,
          WorkshopSlotsDto,
        ),
      ),
    ).then((results) => {
      if (live) setSlots({ day, rows: combineSlots(results.flatMap((r) => (r.ok ? [r.data.slots] : []))) });
    });
    return () => {
      live = false;
    };
  }, [ids, locale, day]);
  return slots?.day === day ? slots.rows : [];
}

/**
 * Workshop Calendar tab (design 2026-11-27 § 6.4, Batch P), read only: a seven-day strip of date chips with the number
 * of accepted visits, and the chosen day's visits by hour. The data is the workshop's `active` list, whose rows carry
 * the accepted proposal's date and hour; the day is `?day=` (a link per chip, so Back works and nothing is lost on a
 * reload). All days are IST. An empty day says so and offers the one next action: look at new requests.
 */
export function WorkshopCalendarApi() {
  const t = useTranslations('partnerWorkshop');
  const rq = useTranslations('request');
  const locale = useLocale();
  const params = useSearchParams();
  const now = useNow(POLL_MS);
  const page = useCallback(
    async (cursor: string | null) => {
      const q = new URLSearchParams({ view: 'active', locale: locale === 'hi' ? 'hi' : 'en' });
      if (cursor) q.set('cursor', cursor);
      const res = await adminApi(locale, `/workshop/requests?${q.toString()}`, ServiceRequestPageDto);
      return res.ok ? { ok: true as const, data: { items: res.data.items, next: res.data.nextCursor } } : res;
    },
    [locale],
  );
  const active = useApiList<ServiceRequestSummary>(page, POLL_MS);

  // Fetch the rest of the live jobs so a day's count is the whole truth, not the first page.
  const pages = useRef(0);
  const { next, loading, loadMore } = active;
  useEffect(() => {
    if (loading || !next || pages.current >= MAX_AUTO_PAGES) return;
    pages.current += 1;
    void loadMore();
  }, [loading, next, loadMore]);

  const days = calendarDays(new Date(now));
  const day = pickDay(params.get('day'), days);
  const counts = dayCounts(active.items, days);
  const agenda = agendaFor(active.items, day);
  const hours = agendaWithCapacity(agenda, useDayCapacity(locale, day));
  const shownLoading = active.loading || Boolean(active.next && pages.current < MAX_AUTO_PAGES);

  const offset = days.indexOf(day);
  useEffect(() => {
    if (!shownLoading) track('partner_calendar_day_viewed', { portal: 'workshop', offset });
  }, [offset, shownLoading]);

  return (
    <section aria-labelledby="cal-title" className="grid gap-3">
      <h2 id="cal-title" className="font-heading text-xl font-extrabold text-ink">
        {t('cal_title')}
      </h2>
      <nav aria-label={t('cal_days_label')}>
        <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 py-1">
          {days.map((d, i) => {
            const n = counts[d] ?? 0;
            const current = d === day;
            const label = i === 0 ? t('cal_today') : dayText(d, locale, { weekday: 'short' });
            return (
              <li key={d} className="shrink-0 snap-start">
                <LocalLink
                  href={`/partner/workshop/calendar?day=${d}`}
                  aria-current={current ? 'date' : undefined}
                  className="press flex min-h-16 min-w-14 flex-col items-center justify-center gap-0.5 rounded-card border border-line-card bg-surface px-2 py-1 text-ink hover:border-ink/30 aria-[current=date]:border-navy aria-[current=date]:bg-navy aria-[current=date]:text-white focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  <span className="text-xs font-bold">{label}</span>
                  <span className="font-heading text-lg font-extrabold tabular-nums">
                    {dayText(d, locale, { day: 'numeric' })}
                  </span>
                  <span
                    className={`min-w-6 rounded-pill px-1.5 text-center text-xs font-extrabold tabular-nums ${
                      n > 0
                        ? current
                          ? 'bg-white text-navy'
                          : 'bg-accent-soft text-accent-soft-text'
                        : current
                          ? 'text-white/80'
                          : 'text-muted'
                    }`}
                  >
                    <span aria-hidden="true">{n}</span>
                    <span className="sr-only">{t('cal_count', { count: n })}</span>
                  </span>
                </LocalLink>
              </li>
            );
          })}
        </ul>
      </nav>

      <h3 className="font-heading text-lg font-extrabold text-ink">
        {t('cal_day_title', {
          date: dayText(day, locale, { weekday: 'long', day: 'numeric', month: 'long' }),
        })}
      </h3>
      <ApiListState
        loading={shownLoading}
        error={active.error}
        count={agenda.length}
        empty={
          <div className="mt-3 grid justify-items-start gap-3 rounded-card border border-dashed border-line-card bg-surface p-6">
            <p className="text-sm text-muted">{t('cal_empty')}</p>
            <LocalLink href="/partner/workshop" className={portalQuiet}>
              {t('cal_empty_action')}
            </LocalLink>
          </div>
        }
        onRetry={() => void active.reload()}
      />
      {hours.length > 0 ? (
        <ol className="grid gap-3">
          {hours.map((g) => (
            <li key={g.hour ?? 'none'} className="grid gap-2 sm:grid-cols-[4.5rem_1fr]">
              <p className="font-heading text-lg font-extrabold text-ink tabular-nums">
                {g.hour === null ? t('cal_hour_unset') : hourText(g.hour)}
              </p>
              <div className="grid gap-2">
                {g.places ? (
                  <p className="text-sm font-bold text-muted">
                    {g.places.capacity === 0
                      ? t('cal_hour_closed')
                      : g.places.free > 0
                        ? t('cal_free', { free: g.places.free, capacity: g.places.capacity })
                        : t('cal_full', { capacity: g.places.capacity })}
                  </p>
                ) : null}
                <ul className="grid gap-2">
                  {g.jobs.map((j) => (
                    <li key={j.code}>
                      <LocalLink
                        href={`/partner/workshop/jobs?job=${j.code}`}
                        className={`${portalCard} block !p-4 hover:border-ink/30 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus`}
                      >
                        <span className="block font-heading font-extrabold text-ink">{j.code}</span>
                        <span className="block text-sm text-ink">{j.vehicle.text}</span>
                        <span className="block text-sm text-muted">
                          {j.services.map((s) => s.title).join(', ')}
                        </span>
                        <span className="mt-1 block text-xs font-bold text-muted">
                          {rq(requestStatusKey(j.status) as 'stage_requested')}
                        </span>
                      </LocalLink>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
