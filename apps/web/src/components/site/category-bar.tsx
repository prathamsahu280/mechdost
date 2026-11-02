import { useTranslations } from 'next-intl';
import { CATEGORY_KEYS, CATEGORY_SLUGS } from '@/demo/catalogue';
import { CATEGORY_ICONS } from '@/lib/icons';
import { LocalLink } from '../ui/local-link';
import { NavLinks, type NavItem } from './nav-links';

/**
 * Second header row (redesign 2026-11-02, SpareVillage-style category bar): the primary links (≥1024px) and
 * category pills that scroll sideways. Not sticky — it scrolls away so the sticky row stays slim. Category links are
 * plain GETs to /shop?category=…; admin-managed categories replace the fixed list in Phase 1 (spec 08).
 */
export function CategoryBar({ navItems, navLabel }: { navItems: readonly NavItem[]; navLabel: string }) {
  const t = useTranslations('header');
  const cat = useTranslations('categories');
  return (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-[5%]">
        <NavLinks label={navLabel} items={navItems} />
        <span aria-hidden="true" className="hidden h-6 w-px shrink-0 bg-line-card nav:block" />
        <nav aria-label={t('categoriesLabel')} className="min-w-0 flex-1">
          <ul className="-my-px flex gap-1.5 overflow-x-auto py-2.5 pr-8 [mask-image:linear-gradient(to_right,black_calc(100%-3rem),transparent)] [scrollbar-width:none]">
            {CATEGORY_KEYS.map((key) => {
              const Icon = CATEGORY_ICONS[key];
              return (
                <li key={key} className="shrink-0">
                  <LocalLink
                    href="/shop"
                    query={{ category: CATEGORY_SLUGS[key] }}
                    data-track={`header_category_${CATEGORY_SLUGS[key]}`}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-pill px-3 text-[13px] font-semibold whitespace-nowrap text-muted transition-colors duration-[var(--duration-fast)] hover:bg-pill hover:text-ink"
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
                    {cat(key)}
                  </LocalLink>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
