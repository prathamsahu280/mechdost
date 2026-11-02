import { MessageCircle, ReceiptText, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Container } from '../ui/page-intro';
import { stagger } from '@/lib/motion';

const ITEMS: { key: 'approve' | 'checked' | 'support'; icon: LucideIcon }[] = [
  { key: 'approve', icon: ReceiptText },
  { key: 'checked', icon: ShieldCheck },
  { key: 'support', icon: MessageCircle },
];

/** Three promises right under the hero (concept "promise strip", promoted to the home page). */
export function TrustStrip() {
  const t = useTranslations('home.trust');
  return (
    <section aria-label={t('label')} className="pt-6">
      <Container>
        <ul className="grid gap-3 tab:grid-cols-3">
          {ITEMS.map(({ key, icon: Icon }, i) => (
            <li
              key={key}
              style={stagger(i)}
              className="reveal flex items-start gap-3 rounded-tile border border-line-card bg-surface p-4 shadow-card"
            >
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-text"
              >
                <Icon className="size-5" strokeWidth={2} />
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
