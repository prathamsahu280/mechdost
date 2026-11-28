import { getTranslations } from 'next-intl/server';
import { Container } from '@/components/ui/page-intro';

/** Route loading skeleton: stable boxes in the final layout (no shift), announced once for screen readers. */
export default async function Loading() {
  const t = await getTranslations('common');
  return (
    <Container className="min-h-dvh py-10 tab:py-14">
      <p role="status" className="sr-only">
        {t('loading')}
      </p>
      <div aria-hidden="true">
        <div className="skeleton h-3 w-40 rounded" />
        <div className="skeleton mt-5 h-10 w-3/4 max-w-xl rounded-lg" />
        <div className="skeleton mt-3 h-4 w-2/3 max-w-lg rounded" />
        <ul className="mt-10 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 nav:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="rounded-card border border-line-card bg-surface p-4">
              <div className="skeleton aspect-[4/3] rounded-tile" />
              <div className="skeleton mt-4 h-3 w-1/3 rounded" />
              <div className="skeleton mt-2 h-5 w-3/4 rounded" />
              <div className="skeleton mt-4 h-11 w-full rounded-button" />
            </li>
          ))}
        </ul>
      </div>
    </Container>
  );
}
