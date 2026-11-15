'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ShopOfferList } from '@mechdost/shared/order-views';
import { adminApi } from '@/lib/admin-api';
import { fetchProductPhotos } from '@/lib/product-photos-api';
import { portalCard } from './portal-styles';
import { ProductPhotosEditor } from './product-photos-editor';

interface Product {
  slug: string;
  name: string;
}
type Load = { kind: 'loading' } | { kind: 'hidden' } | { kind: 'ok'; products: Product[] };

/**
 * "Product photos" in the shop portal (spec 02, design 2026-11-15 item 1): shown only while the admin setting lets
 * shops add photos. One entry per product the shop sells; opening it shows the photos and, for a free slot, the form.
 * What the shop adds waits for staff approval. Real API mode only; nothing here for a shop whose setting is off.
 */
export function ShopPhotosApi({ shopId }: { shopId: string }) {
  const t = useTranslations('storefront');
  const locale = useLocale();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    const gate = { live: true };
    const alive = () => gate.live;
    void (async () => {
      const res = await adminApi(
        locale,
        `/shops/${shopId}/inventory?locale=${locale === 'hi' ? 'hi' : 'en'}`,
        ShopOfferList,
      );
      if (!alive()) return;
      const seen = new Map<string, Product>();
      if (res.ok)
        for (const o of res.data.offers) seen.set(o.productSlug, { slug: o.productSlug, name: o.product });
      const products = [...seen.values()];
      const first = products[0];
      if (!first) {
        setLoad({ kind: 'hidden' });
        return;
      }
      const probe = await fetchProductPhotos(locale, 'shop', first.slug);
      if (!alive()) return;
      setLoad(probe.ok && probe.data.shopUploadsEnabled ? { kind: 'ok', products } : { kind: 'hidden' });
    })();
    return () => {
      gate.live = false;
    };
  }, [locale, shopId]);

  if (load.kind !== 'ok') return null;
  return (
    <section aria-labelledby={`shop-photos-${shopId}`} className={portalCard}>
      <h3 id={`shop-photos-${shopId}`} className="font-heading text-lg font-extrabold text-ink">
        {t('shopPhotosTitle')}
      </h3>
      <p className="mt-1 text-sm text-muted">{t('shopPhotosLead')}</p>
      <ul className="mt-4 space-y-2">
        {load.products.map((p) => (
          <li key={p.slug}>
            <details className="rounded-tile border border-line-card bg-surface-alt p-3">
              <summary className="min-h-11 cursor-pointer py-2 font-bold text-ink" data-user-content>
                {p.name}
              </summary>
              <div className="mt-3">
                <ProductPhotosEditor slug={p.slug} scope="shop" />
              </div>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
