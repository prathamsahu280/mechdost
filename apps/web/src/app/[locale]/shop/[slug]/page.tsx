import { CheckCircle2, Clock, MessageCircle, ShieldCheck, Truck } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache, Suspense } from 'react';
import { getTranslations } from 'next-intl/server';
import { AddToCartButton, type AddToCartLabels } from '@/components/catalogue/add-to-cart-button';
import { SizeBuyBox, type SizeBuyBoxLabels } from '@/components/catalogue/size-buy-box';
import { sizeOptions } from '@/lib/catalogue/size-options';
import { SellerNote } from '@/components/commerce/seller-note';
import { CompareToggle } from '@/components/catalogue/compare-toggle';
import { UnitPrice } from '@/components/catalogue/unit-price';
import { availabilityLabel, ProductCard } from '@/components/catalogue/product-card';
import { ClientMessages } from '@/components/ui/client-messages';
import { ProductGallery } from '@/components/catalogue/product-gallery';
import { ProductPhoto, productPhotoLoader } from '@/components/catalogue/product-photo';
import { ProductVisual } from '@/components/catalogue/product-visual';
import { RecommendationsSection } from '@/components/catalogue/recommendations-section';
import { WishlistHeartLazy } from '@/components/catalogue/wishlist-lazy';
import { ReviewsApiSection, ReviewsApiSkeleton } from '@/components/reviews/reviews-api-section';
import { ReviewsSection } from '@/components/reviews/reviews-section';
import { StarRating } from '@/components/reviews/star-rating';
import { SettingValue } from '@/components/site/site-overrides';
import { TrustLine } from '@/components/site/trust-line';
import { LocalLink } from '@/components/ui/local-link';
import { Container } from '@/components/ui/page-intro';
import { DEMO_PRODUCTS, findProduct } from '@/demo/catalogue';
import { productRating, productReviews, type RatingSummary, type SeedReview } from '@/demo/reviews';
import { routing, type Locale } from '@/i18n/routing';
import { fetchCatalogueProduct, fetchCataloguePage } from '@/lib/catalogue/api-source';
import { demoCard, demoProduct } from '@/lib/catalogue/demo-source';
import type { CardView, ProductView } from '@/lib/catalogue/view';
import { DATA_MODE, QUOTES_AVAILABLE } from '@/lib/data-mode';
import { discountPercent, formatPrice } from '@/lib/format';
import { mrpOnly } from '@/lib/catalogue/mrp-only';
import { alternatesFor, metaDescription, openGraphFor } from '@/lib/seo';
import { breadcrumbLd, productLd } from '@/lib/structured-data';
import { JsonLd } from '@/components/site/json-ld';
import { localePath } from '@/lib/locale-path';
import { site, whatsappLink } from '@/lib/site';
import { productFullName } from '@/lib/product-name';

/** Real sign-in and real data: the saved vehicle can preselect the size that fits it. */
const SIZE_FIT = DATA_MODE === 'api' && process.env.NEXT_PUBLIC_AUTH_MODE === 'firebase';

interface Props {
  params: Promise<{ locale: Locale; slug: string }>;
}

/** API mode prerenders nothing at build (no build-time API dependency); pages render on first visit and are
 * kept for 60 s by the fetch cache (ISR). Demo mode prerenders every demo product. */
export function generateStaticParams() {
  if (DATA_MODE === 'api') return [];
  return routing.locales.flatMap((locale) => DEMO_PRODUCTS.map((p) => ({ locale, slug: p.slug })));
}

interface Loaded {
  product: ProductView;
  related: CardView[];
  /** Demo data only; real data mode streams `ReviewsApiSection` instead. */
  reviews: { summary: RatingSummary; list: SeedReview[] } | null;
}

/** The product, its related products and its reviews; `null` → 404. Cached per request (metadata + page). */
const load = cache(async (slug: string, locale: Locale): Promise<Loaded | null> => {
  if (DATA_MODE === 'api') {
    const product = await fetchCatalogueProduct(slug, locale);
    if (!product) return null;
    const page = await fetchCataloguePage({ locale, category: product.category.slug, limit: 5 });
    return {
      product,
      related: page.items.filter((p) => p.slug !== slug).slice(0, 4),
      reviews: null,
    };
  }
  const found = findProduct(slug);
  if (!found) return null;
  return {
    product: demoProduct(found, locale),
    related: DEMO_PRODUCTS.filter((p) => p.category === found.category && p.slug !== slug)
      .slice(0, 4)
      .map((p) => demoCard(p, locale)),
    reviews: { summary: productRating(found), list: productReviews(found) },
  };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const data = await load(slug, locale);
  if (!data) return {};
  const { product } = data;
  const [t, regions] = await Promise.all([
    getTranslations({ locale, namespace: 'seo' }),
    getTranslations({ locale, namespace: 'regions' }),
  ]);
  const region = regions(site.defaultRegion);
  const title = t('productTitle', { product: productFullName(product.brand, product.name), region });
  const details = [product.spec, product.compatibility]
    .filter(Boolean)
    .join('. ')
    .replace(/[.।\s]+$/, '');
  const description = metaDescription(t('productDescription', { details, region }));
  const photo = product.photo;
  return {
    title,
    description,
    alternates: alternatesFor(`/shop/${slug}`, locale),
    openGraph: openGraphFor({
      href: `/shop/${slug}`,
      locale,
      title,
      description,
      ...(photo
        ? {
            image: {
              url: productPhotoLoader({ src: photo.path, width: 1200 }),
              width: photo.width,
              height: photo.height,
              alt: photo.alt,
            },
          }
        : {}),
    }),
  };
}

/**
 * Product detail (spec 02): artwork, price + MRP, availability, delivery estimate, highlights, specs, related.
 * a11y review 2026-11-10: unknown facts are left out (no blank rows, no "0 stars", no empty headings); a product
 * with no price offers one next step, "Ask about this product" on WhatsApp, instead of add to cart.
 */
export default async function ProductPage({ params }: Props) {
  const { locale, slug } = await params;
  const data = await load(slug, locale);
  if (!data) notFound();
  const { product, related, reviews } = data;

  const [t, c, r, footer, cmp, w, nav, cartNs] = await Promise.all([
    getTranslations('catalogue'),
    getTranslations('categories'),
    getTranslations('reviews'),
    getTranslations('footer'),
    getTranslations('compare'),
    getTranslations('storefront'),
    getTranslations('nav'),
    getTranslations('cart'),
  ]);
  const galleryPhotos = product.photos?.length ? product.photos : product.photo ? [product.photo] : [];
  const categoryName = product.category.name ?? (product.category.key ? c(product.category.key) : null);
  // The star row links to the reviews section, so it shows only when that section does (approved reviews only:
  // the catalogue's rating and the API section count the same rows).
  const rating =
    (reviews || DATA_MODE === 'api') && product.rating && product.rating.count > 0 ? product.rating : null;
  const price = product.price;
  const mrp = mrpOnly(product);
  const off = price ? discountPercent(price.pricePaise, price.mrpPaise ?? undefined) : 0;
  const onRequest = product.availability === 'on_request';
  const rows = productRows(t, product);
  // Several sizes (user 2026-11-24): the buying area is the size picker island; one size keeps the plain markup.
  const multi = product.variants.length > 1;
  const fullName = productFullName(product.brand, product.name);
  const cartLabels: AddToCartLabels = {
    add: t('addToCart'),
    added: t('added'),
    maxQty: t('maxQty'),
    maxLines: t('maxLines'),
    saveFailed: t('saveFailed'),
    increase: t('cartIncrease', { name: fullName }),
    decrease: t('cartDecrease', { name: fullName }),
    remove: t('cartRemove', { name: fullName }),
    removed: t('cartRemoved'),
    inCart: t('inCart', { count: '#' }),
  };
  const sizeList = multi
    ? sizeOptions(product.variants, {
        price: formatPrice,
        mrp: (paise) => t('mrp', { price: formatPrice(paise) }),
        mrpOnly: (paise) => t('mrp', { price: formatPrice(paise) }),
        save: (percent) => t('save', { percent }),
        unit: (per, paise) => t(`unitPrice_${per}`, { price: formatPrice(paise) }),
        inStock: t('inStock'),
        onRequest: t('sizeOnRequest'),
        outOfStock: t('sizeOutOfStock'),
        delivery: (days) => t('delivery', { days }),
        askHref: (label) => whatsappLink(t('askAboutMessage', { product: `${fullName} (${label})` })),
      })
    : [];
  const sizeLabels: SizeBuyBoxLabels = {
    size: t('size'),
    help: t('sizeHelp'),
    outOfStock: t('sizeOutOfStock'),
    onRequest: t('sizeOnRequest'),
    unavailable: t('sizeUnavailable'),
    fits: t('sizeFits', { vehicle: '{vehicle}' }),
    chosen: t('sizeChosen', { size: '{size}' }),
    opened: t('sizeOpened', { size: '{size}' }),
    groupRim: t('sizeGroupRim', { rim: '{rim}' }),
    groupOther: t('sizeGroupOther'),
    inclusive: t('inclusive'),
    askAbout: t('askAboutProduct'),
    whatsappNote: footer('whatsappNote'),
    sellerCannotOrder: cartNs('sellerCannotOrder'),
  };
  const path = localePath(`/shop/${slug}`, locale);
  const crumbs = [
    { name: nav('home'), path: localePath('/', locale) },
    { name: nav('shop'), path: localePath('/shop', locale) },
    ...(categoryName
      ? [{ name: categoryName, path: localePath(`/shop?category=${product.category.slug}`, locale) }]
      : []),
    { name: productFullName(product.brand, product.name), path },
  ];
  // Offers and ratings are marked up from real data only (demo prices and seed reviews are not real).
  const productData = DATA_MODE === 'api' ? productLd(product, path, categoryName) : null;

  const extras = (
    <>
      <CompareToggle
        slug={product.slug}
        category={product.category.slug}
        categoryName={categoryName}
        labels={{
          toggle: cmp('toggle'),
          toggleName: cmp('toggleName', { name: productFullName(product.brand, product.name) }),
          added: cmp('added', { count: '{count}' }),
          removed: cmp('removed'),
          hint: cmp('hint'),
        }}
      />
      <div className="mt-3">
        <WishlistHeartLazy
          slug={product.slug}
          source="page"
          labels={{
            add: w('wishlistAdd', { name: productFullName(product.brand, product.name) }),
            remove: w('wishlistRemove', { name: productFullName(product.brand, product.name) }),
            saved: w('wishlistSaved'),
            removed: w('wishlistRemoved'),
            full: w('wishlistFull', { max: 100 }),
            failed: w('wishlistFailed'),
            signIn: w('wishlistSignIn'),
            pageSave: w('pageSave'),
            pageSaved: w('pageSaved'),
          }}
        />
      </div>
    </>
  );

  return (
    <Container className="py-8 tab:py-12">
      <JsonLd data={productData ? [productData, breadcrumbLd(crumbs)] : breadcrumbLd(crumbs)} />
      <nav aria-label={t('breadcrumb')} className="text-sm text-muted">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <LocalLink href="/shop" className="font-bold text-ink hover:underline">
              {t('back')}
            </LocalLink>
          </li>
          {categoryName ? (
            <>
              <li aria-hidden="true">/</li>
              <li>
                <LocalLink
                  href="/shop"
                  query={{ category: product.category.slug }}
                  className="hover:underline"
                >
                  {categoryName}
                </LocalLink>
              </li>
            </>
          ) : null}
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-ink">
            {product.name}
          </li>
        </ol>
      </nav>

      <div className="mt-6 grid gap-8 tab:grid-cols-2 nav:gap-14">
        <div data-product-media>
          {galleryPhotos.length > 0 ? (
            // The first photo is the page's largest paint: the one image with `priority` (spec 16). The gallery
            // (client) only switches between pictures rendered here.
            <ClientMessages namespaces={['photos']}>
              <ProductGallery
                photos={galleryPhotos}
                slides={galleryPhotos.map((p, i) => (
                  <ProductPhoto
                    key={p.path}
                    photo={p}
                    size="hero"
                    priority={i === 0}
                    sizes="(min-width: 1024px) 560px, 100vw"
                  />
                ))}
                thumbs={galleryPhotos.map((p) => (
                  <ProductPhoto key={p.path} photo={p} size="thumb" sizes="80px" className="rounded-none" />
                ))}
              />
            </ClientMessages>
          ) : (
            <ProductVisual
              category={product.category.key}
              brand={product.brand}
              sku={product.sku}
              size="hero"
            />
          )}
        </div>

        <div>
          <p className="text-xs text-muted">
            <span className="font-bold uppercase">{product.brand}</span>
            {categoryName ? ` · ${categoryName}` : null}
          </p>
          <h1 className="mt-2 font-heading text-[clamp(28px,3vw,40px)] leading-tight font-extrabold tracking-[-0.02em] text-ink">
            {product.name}
          </h1>
          {product.spec ? <p className="mt-2 text-[15px] text-muted">{product.spec}</p> : null}
          {rating ? (
            <a
              href={`#reviews-${product.slug}`}
              className="mt-3 inline-flex min-h-6 items-center gap-2 text-sm"
            >
              <StarRating
                rating={rating.avg}
                size="md"
                label={r('ratedBy', { rating: rating.avg.toFixed(1), count: rating.count })}
              />
              <span aria-hidden="true" className="font-bold text-ink">
                {rating.avg.toFixed(1)}
              </span>
              <span className="text-muted underline-offset-4 hover:underline">
                {r('count', { count: rating.count })}
              </span>
            </a>
          ) : null}

          {multi ? (
            <SizeBuyBox
              slug={product.slug}
              sizes={sizeList}
              defaultSku={product.defaultSku ?? product.variants[0]?.sku ?? ''}
              labels={sizeLabels}
              cartLabels={cartLabels}
              canFit={SIZE_FIT}
              locale={locale}
              showSellerNote
              trust={
                <TrustLine
                  placement="product"
                  brand={product.brand}
                  className="mt-3 text-sm font-bold text-ink before:mr-2 before:text-success before:content-['✓']"
                />
              }
              extras={extras}
            />
          ) : (
            <>
              {price ? (
                <>
                  <div className="mt-5 flex flex-wrap items-baseline gap-3">
                    <span className="font-heading text-[34px] font-extrabold text-ink">
                      {formatPrice(price.pricePaise)}
                    </span>
                    {price.mrpPaise && off ? (
                      <>
                        <span className="text-sm text-muted line-through">
                          {t('mrp', { price: formatPrice(price.mrpPaise) })}
                        </span>
                        <span className="rounded-md bg-success-bg px-2 py-0.5 text-xs font-bold text-success">
                          {t('save', { percent: off })}
                        </span>
                      </>
                    ) : null}
                  </div>
                  <UnitPrice pricePaise={price.pricePaise} pack={product.pack} className="mt-1 text-sm" />
                  <p className="mt-1 text-xs text-muted">{t('inclusive')}</p>
                </>
              ) : mrp ? (
                <p className="mt-5 font-heading text-2xl font-extrabold text-ink">
                  {t(mrp.key, { price: formatPrice(mrp.paise) })}
                </p>
              ) : null}

              {/* Trust line near the price (design 2026-11-15). "GST bill" is added only for a GST-registered selling shop;
              the product page does not know the shop yet, so it is left out (never a blanket claim). */}
              {/* Only when a verified shop actually offers it (live check 2026-11-22: "from a verified shop" showed on
              imported products no shop stocks yet). */}
              {onRequest ? null : (
                <TrustLine
                  placement="product"
                  brand={product.brand}
                  className="mt-3 text-sm font-bold text-ink before:mr-2 before:text-success before:content-['✓']"
                />
              )}

              <ul className="mt-5 space-y-2 text-sm">
                <li
                  className={`flex items-center gap-2 font-bold ${onRequest ? 'text-warning' : 'text-success'}`}
                >
                  {onRequest ? (
                    <Clock aria-hidden="true" className="size-4" />
                  ) : (
                    <CheckCircle2 aria-hidden="true" className="size-4" />
                  )}
                  {availabilityLabel(t, product.availability)}
                </li>
                {product.leadDays !== null ? (
                  <li className="flex items-center gap-2 text-ink">
                    <Truck aria-hidden="true" className="size-4 text-muted" />
                    {t('delivery', { days: product.leadDays })}
                  </li>
                ) : null}
                <li className="flex items-center gap-2 text-ink">
                  <ShieldCheck aria-hidden="true" className="size-4 text-muted" />
                  {t('fitNote')}
                </li>
              </ul>

              {/* "☐ Compare" right above the main action, the same control as on the cards (user ruling 2026-11-15,
              "Checkbox style"; UI review 2026-11-14: it must not sit below the fold on phones). */}
              <div className="mt-5 max-w-md">
                {extras}
                <div className="mt-1">
                  {price ? (
                    <AddToCartButton
                      sku={product.sku}
                      defaultSku={product.sku}
                      slug={product.slug}
                      labels={{
                        add: t('addToCart'),
                        added: t('added'),
                        maxQty: t('maxQty'),
                        maxLines: t('maxLines'),
                        saveFailed: t('saveFailed'),
                        increase: t('cartIncrease', { name: productFullName(product.brand, product.name) }),
                        decrease: t('cartDecrease', { name: productFullName(product.brand, product.name) }),
                        remove: t('cartRemove', { name: productFullName(product.brand, product.name) }),
                        removed: t('cartRemoved'),
                        inCart: t('inCart', { count: '#' }),
                      }}
                      className="min-h-12"
                    />
                  ) : (
                    <a
                      href={whatsappLink(
                        t('askAboutMessage', { product: productFullName(product.brand, product.name) }),
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-track="product_ask_whatsapp"
                      className="press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-button bg-whatsapp px-5 text-sm font-bold text-white"
                    >
                      <MessageCircle aria-hidden="true" className="size-4" />
                      {t('askAboutProduct')}
                      <span className="sr-only"> ({footer('whatsappNote')})</span>
                    </a>
                  )}
                  {/* Only a signed-in shop account sees it (they browse, they do not buy; user 2026-11-22). */}
                  {price ? <SellerNote text={cartNs('sellerCannotOrder')} className="mt-3" /> : null}
                </div>
              </div>
            </>
          )}
          <div className="max-w-md">
            {QUOTES_AVAILABLE ? (
              <p className="mt-3 text-sm text-muted">
                <LocalLink
                  href="/quotes/new"
                  query={{ product: product.slug }}
                  data-track="product_bulk_quote"
                  className="inline-flex min-h-6 items-center font-bold text-accent-soft-text underline-offset-4 hover:underline"
                >
                  {t.rich('bulkHint', {
                    min: (chunks) => <SettingValue setting="bulkMinUnits" fallback={chunks} />,
                  })}
                </LocalLink>
              </p>
            ) : null}
            <p className="mt-2 text-sm text-muted">
              <span aria-hidden="true">🚫 </span>
              {t('policyNote')}{' '}
              <LocalLink
                href="/policies/returns"
                data-track="product_returns_policy"
                className="font-bold text-ink underline underline-offset-2"
              >
                {t('policyLink')}
              </LocalLink>
            </p>
          </div>

          {product.highlights.length > 0 ? (
            <div className="mt-8">
              <h2 id="highlights" className="font-heading text-lg font-bold text-ink">
                {t('highlights')}
              </h2>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
                {product.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {rows.length > 0 ? (
            <dl className="mt-6 divide-y divide-line rounded-tile border border-line-card bg-surface text-sm">
              {rows.map((row) => (
                <div key={row.key} className="grid grid-cols-[140px_1fr] gap-3 px-4 py-3">
                  <dt className="font-bold text-ink">{row.term}</dt>
                  <dd className="text-muted">{row.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>

      {reviews ? (
        <ReviewsSection
          target="product"
          slug={product.slug}
          summary={reviews.summary}
          reviews={reviews.list}
        />
      ) : null}
      {DATA_MODE === 'api' ? (
        <Suspense fallback={<ReviewsApiSkeleton />}>
          <ReviewsApiSection target="product" slug={product.slug} />
        </Suspense>
      ) : null}

      {/* "Goes well with this" (spec 11): rules, then what customers bought together; streams in, nothing when empty. */}
      {DATA_MODE === 'api' ? (
        <Suspense fallback={null}>
          <RecommendationsSection slugs={[product.slug]} slot="product" locale={locale} />
        </Suspense>
      ) : null}

      {related.length > 0 ? (
        <section aria-labelledby="related" className="mt-14">
          <h2 id="related" className="font-heading text-2xl font-extrabold tracking-[-0.02em] text-ink">
            {categoryName ? t('related', { category: categoryName }) : t('relatedAny')}
          </h2>
          <ul className="card-grid mt-5 grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 nav:grid-cols-4">
            {related.map((p) => (
              <li key={p.slug}>
                <ProductCard product={p} scope="related" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Container>
  );
}

/** Specification table rows; empty facts are dropped (no blank definitions). */
function productRows(
  t: (key: 'specification' | 'compatibility' | 'sku' | 'origin') => string,
  p: ProductView,
): { key: string; term: string; value: string }[] {
  return [
    { key: 'spec', term: t('specification'), value: p.spec },
    { key: 'compat', term: t('compatibility'), value: p.compatibility },
    { key: 'sku', term: t('sku'), value: p.partReference },
    { key: 'origin', term: t('origin'), value: p.countryOfOrigin },
  ].filter((row): row is { key: string; term: string; value: string } => Boolean(row.value));
}
