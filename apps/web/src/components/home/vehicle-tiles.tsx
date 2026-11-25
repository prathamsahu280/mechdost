import { useLocale, useTranslations } from 'next-intl';
import { localePath } from '@/lib/locale-path';
import type { HomeSegmentTile } from '@/lib/catalogue/home-segments';
import { Container, Eyebrow } from '../ui/page-intro';
import { ButtonLink } from '../ui/button-link';
import { SegmentTileLink } from './segment-tile-link';

/** Decorative icon per tile (always `aria-hidden`; the name carries the meaning). */
const ICON: Record<HomeSegmentTile['code'], string> = {
  truck_bus: '🚛',
  tractor_farm: '🚜',
  construction_otr: '🏗️',
  // The other segments are not home tiles today; the map is total so a later tile never lacks one.
  two_wheeler: '🛵',
  three_wheeler: '🛺',
  car_suv: '🚗',
  light_commercial: '🚐',
  not_vehicle: '🔋',
};

/**
 * Home "Shop by vehicle" (design 2026-11-25): tiles for the vehicles people earn a living with. A normal home section the
 * admin orders or hides in the layout editor (hard rule 8); names and descriptions come from the segment table in
 * either language. Each tile opens the shop filtered to that segment.
 */
export function VehicleTiles({ tiles }: { tiles: readonly HomeSegmentTile[] }) {
  const t = useTranslations('home.vehicles');
  const s = useTranslations('segments');
  const locale = useLocale();
  return (
    <section aria-labelledby="vehicles-title" className="pt-14 tab:pt-16">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Eyebrow>{t('eyebrow')}</Eyebrow>
            <h2
              id="vehicles-title"
              className="mt-4 font-heading text-[clamp(28px,3vw,40px)] font-extrabold tracking-[-0.03em] text-ink"
            >
              {t('title')}
            </h2>
            <p className="mt-2 max-w-xl text-[15px] text-muted">{t('lead')}</p>
          </div>
          <ButtonLink href="/shop" variant="quiet" data-track="home_view_all_vehicles">
            {t('viewAll')}
          </ButtonLink>
        </div>
        <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {tiles.map((tile) => (
            <li key={tile.code}>
              <SegmentTileLink
                href={`${localePath('/shop', locale)}?segment=${tile.code}`}
                segment={tile.code}
                className="group press reveal flex h-full min-h-[96px] items-center gap-4 rounded-tile border border-line-card bg-surface px-4 py-4 shadow-card transition duration-[var(--duration-base)] hover:-translate-y-1 hover:border-accent-soft hover:shadow-card-hover"
              >
                <span
                  aria-hidden="true"
                  className="grid size-14 shrink-0 place-items-center rounded-full bg-accent-soft text-[28px] leading-none transition-transform duration-[var(--duration-base)] group-hover:scale-110"
                >
                  {ICON[tile.code]}
                </span>
                <span className="min-w-0">
                  <span className="block text-[16px] font-bold text-ink">{tile.name}</span>
                  {tile.description ? (
                    <span className="mt-0.5 block text-xs leading-snug text-muted">{tile.description}</span>
                  ) : null}
                  {tile.count !== null ? (
                    <span className="mt-1 block text-xs font-bold text-accent-soft-text">
                      {s('tileCount', { count: tile.count })}
                    </span>
                  ) : null}
                </span>
              </SegmentTileLink>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
