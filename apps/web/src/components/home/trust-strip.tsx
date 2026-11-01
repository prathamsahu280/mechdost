import { useTranslations } from 'next-intl';
import { Container } from '../ui/page-intro';

const ITEMS: { key: 'approve' | 'checked' | 'support'; emoji: string }[] = [
  { key: 'approve', emoji: '🧾' },
  { key: 'checked', emoji: '✅' },
  { key: 'support', emoji: '💬' },
];

/** Three promises right under the hero (concept "promise strip", promoted to the home page). */
export function TrustStrip() {
  const t = useTranslations('home.trust');
  return (
    <section aria-label={t('label')} className="pt-6">
      <Container>
        <ul className="grid gap-3 tab:grid-cols-3">
          {ITEMS.map(({ key, emoji }) => (
            <li
              key={key}
              className="flex items-start gap-3 rounded-tile border border-line-card bg-surface p-4 shadow-card"
            >
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-[20px]"
              >
                {emoji}
              </span>
              <span>
                <span className="block font-heading text-[15px] font-bold text-ink">{t(`${key}Title`)}</span>
                <span className="mt-0.5 block text-sm text-muted">{t(`${key}Body`)}</span>
              </span>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
