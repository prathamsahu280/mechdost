import { useTranslations } from 'next-intl';
import { ButtonLink } from '@/components/ui/button-link';
import { Container, EmptyState } from '@/components/ui/page-intro';

export default function NotFound() {
  const t = useTranslations('pages.notFound');
  return (
    <Container className="py-16">
      <h1 className="font-heading text-[clamp(30px,3.4vw,44px)] font-extrabold tracking-[-0.03em] text-ink">
        {t('title')}
      </h1>
      <div className="mt-8">
        <EmptyState
          body={t('body')}
          action={
            <ButtonLink href="/" data-track="not_found_home">
              {t('action')}
            </ButtonLink>
          }
        />
      </div>
    </Container>
  );
}
