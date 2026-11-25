'use client';

import { Check, CheckCircle2, Clock, MessageCircle, Truck } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { track } from '@/lib/analytics';
import { signal } from '@/lib/compare/signal';
import { groupSizesByRim, resolveSizeParam, withSizeParam } from '@/lib/catalogue/size-select';
import { AddToCartButton, type AddToCartLabels } from './add-to-cart-button';
import { SellerNote } from '@/components/commerce/seller-note';

/**
 * One size of a product, with every text already translated and formatted on the server (no i18n runtime and no
 * price formatting ships with this island). `priceText` null = nothing to show as a price.
 */
export interface SizeOption {
  sku: string;
  label: string;
  inStock: boolean;
  priceOnRequest: boolean;
  /** "₹4,200" when a verified shop offers this size now, else null. */
  priceText: string | null;
  mrpText: string | null;
  saveText: string | null;
  unitText: string | null;
  /** "MRP ₹4,550" for a size with an MRP but no shop offer yet (never a price, never sellable). */
  mrpOnlyText: string | null;
  availabilityText: string;
  deliveryText: string | null;
  /** WhatsApp link that asks about this very size. */
  askHref: string;
}

export interface SizeBuyBoxLabels {
  size: string;
  help: string;
  outOfStock: string;
  onRequest: string;
  unavailable: string;
  /** "Fits your {vehicle}": `{vehicle}` is replaced. */
  fits: string;
  /** "{size} selected": `{size}` is replaced; read out by the live region. */
  chosen: string;
  /** "Opened on {size}, the size you searched for.": shown when a `?size=` link (a search result) opened the page. */
  opened: string;
  /** "{rim} inch": the heading of a group of tyre sizes of one rim. */
  groupRim: string;
  groupOther: string;
  inclusive: string;
  askAbout: string;
  whatsappNote: string;
  sellerCannotOrder: string;
}

/**
 * The buying area of a product sold in several sizes (user 2026-11-24, "like 500 ml and 1 L" on Amazon): a size
 * picker, and under it the price, stock, delivery and add-to-cart of the chosen size. Only products with more than
 * one size render this; a single-size page stays exactly as before and ships none of it.
 *
 * - Native radios (one group, arrow keys and focus are the browser's), 44 px targets, the chosen size is filled.
 * - A size that cannot be bought now stays selectable but is marked ("Out of stock", "Price on request"), so the
 *   customer sees why; a size with no price never shows one and never gets an add button.
 * - `?size=<sku or size text>` opens a size (unknown = the default size). The chosen size is written back with
 *   `history.replaceState`; the canonical URL of the page stays the product URL.
 * - Signed in with a saved vehicle, the size that fits it is chosen (unless the link named one) and marked "Fits your
 *   <vehicle>"; the match happens on the server, only a SKU comes back (`vehicle-fit.ts`, loaded on demand).
 * - The server-rendered default size is what the first paint and crawlers see.
 */
export function SizeBuyBox({
  slug,
  sizes,
  defaultSku,
  labels,
  cartLabels,
  canFit,
  locale,
  trust,
  extras,
  showSellerNote,
}: {
  slug: string;
  sizes: readonly SizeOption[];
  defaultSku: string;
  labels: SizeBuyBoxLabels;
  cartLabels: AddToCartLabels;
  canFit: boolean;
  locale: string;
  /** Server-rendered trust line, shown while the chosen size can be bought. */
  trust: ReactNode;
  /** Server-rendered compare and wishlist controls (one place, above the main action). */
  extras: ReactNode;
  showSellerNote: boolean;
}) {
  const [sku, setSku] = useState(defaultSku);
  const [fit, setFit] = useState<{ sku: string; vehicle: string } | null>(null);
  const [linkedSku, setLinkedSku] = useState<string | null>(null);
  const touched = useRef(false);
  const groupId = useId();

  const current = sizes.find((s) => s.sku === sku) ?? sizes[0];
  const groups = groupSizesByRim(sizes);

  // A `?size=` link opens that size; otherwise the saved vehicle's size is preselected once the answer arrives.
  useEffect(() => {
    const linked = resolveSizeParam(sizes, new URLSearchParams(window.location.search).get('size'));
    if (linked) {
      touched.current = true;
      setSku(linked);
      setLinkedSku(linked);
      track('product_size_selected', { slug, sku: linked, source: 'link' });
    }
    if (!canFit) return;
    let live = true;
    void import('@/lib/catalogue/vehicle-fit').then(async ({ fetchVehicleFit }) => {
      const found = await fetchVehicleFit(locale, slug);
      if (!live || !found?.fitsVariantSku || !found.vehicle) return;
      const fitSku = found.fitsVariantSku;
      if (!sizes.some((s) => s.sku === fitSku)) return;
      setFit({ sku: fitSku, vehicle: `${found.vehicle.make} ${found.vehicle.model}`.trim() });
      if (!touched.current) {
        setSku(fitSku);
        track('product_size_selected', { slug, sku: fitSku, source: 'fit' });
      }
    });
    return () => {
      live = false;
    };
  }, [canFit, locale, slug, sizes]);

  if (!current) return null;

  function choose(next: SizeOption) {
    touched.current = true;
    setSku(next.sku);
    signal({ say: labels.chosen.replace('{size}', next.label) });
    try {
      window.history.replaceState(
        window.history.state as unknown,
        '',
        `${window.location.pathname}${withSizeParam(window.location.search, next.sku)}${window.location.hash}`,
      );
    } catch {
      // The address cannot be changed (embedded or sandboxed view): the size still works.
    }
    track('product_size_selected', { slug, sku: next.sku, source: 'tap' });
  }

  const buyable = current.priceText !== null;

  return (
    <div>
      <fieldset className="mt-5">
        <legend className="text-sm font-bold text-ink">{labels.size}</legend>
        <p id={`${groupId}-help`} className="mt-1 text-xs text-muted">
          {labels.help}
        </p>
        {linkedSku && linkedSku === current.sku ? (
          <p role="status" className="mt-1 text-xs font-bold text-success">
            {labels.opened.replace('{size}', current.label)}
          </p>
        ) : null}
        <div className="mt-2 grid gap-3" aria-describedby={`${groupId}-help`}>
          {(groups ?? [{ rim: null as number | null, items: [...sizes], plain: true }]).map((g) => (
            <div
              key={g.rim ?? 'all'}
              role={groups ? 'group' : undefined}
              aria-labelledby={groups ? `${groupId}-g-${String(g.rim)}` : undefined}
            >
              {groups ? (
                <p id={`${groupId}-g-${String(g.rim)}`} className="mb-1.5 text-xs font-bold text-muted">
                  {g.rim === null ? labels.groupOther : labels.groupRim.replace('{rim}', String(g.rim))}
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-2 min-[560px]:grid-cols-3">
                {g.items.map((s) => {
                  const note = s.priceOnRequest
                    ? labels.onRequest
                    : !s.inStock
                      ? s.mrpOnlyText
                        ? `${s.mrpOnlyText} · ${labels.outOfStock}`
                        : labels.outOfStock
                      : fit?.sku === s.sku
                        ? labels.fits.replace('{vehicle}', fit.vehicle)
                        : null;
                  const price = s.inStock && s.priceText ? s.priceText : null;
                  return (
                    <label
                      key={s.sku}
                      data-size={s.sku}
                      className={`press group/size relative flex min-h-14 cursor-pointer flex-col justify-center rounded-button border-2 px-3 py-2 text-sm text-ink has-checked:border-accent-button has-checked:bg-accent-soft has-checked:text-accent-soft-text has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus ${
                        s.inStock && !s.priceOnRequest
                          ? 'border-input-border'
                          : 'border-dashed border-input-border text-muted'
                      }`}
                    >
                      <input
                        type="radio"
                        name={`${groupId}-size`}
                        value={s.sku}
                        checked={s.sku === current.sku}
                        onChange={() => {
                          choose(s);
                        }}
                        className="sr-only"
                      />
                      <Check
                        aria-hidden="true"
                        className="absolute top-1.5 right-1.5 hidden size-4 group-has-checked/size:block"
                      />
                      <span className="pr-5 leading-snug font-bold">{s.label}</span>
                      {price ? (
                        <span className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-xs">
                          <span className="font-bold">{price}</span>
                          {s.mrpText ? <span className="line-through opacity-70">{s.mrpText}</span> : null}
                        </span>
                      ) : null}
                      {note ? (
                        <span
                          className={`mt-0.5 text-xs font-normal ${fit?.sku === s.sku && s.inStock ? 'text-success' : ''}`}
                        >
                          {note}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      {current.priceText ? (
        <>
          <div className="mt-5 flex flex-wrap items-baseline gap-3">
            <span className="font-heading text-[34px] font-extrabold text-ink">{current.priceText}</span>
            {current.mrpText && current.saveText ? (
              <>
                <span className="text-sm text-muted line-through">{current.mrpText}</span>
                <span className="rounded-md bg-success-bg px-2 py-0.5 text-xs font-bold text-success">
                  {current.saveText}
                </span>
              </>
            ) : null}
          </div>
          {current.unitText ? <p className="mt-1 text-sm text-muted">{current.unitText}</p> : null}
          <p className="mt-1 text-xs text-muted">{labels.inclusive}</p>
        </>
      ) : current.mrpOnlyText ? (
        <p className="mt-5 font-heading text-2xl font-extrabold text-ink">{current.mrpOnlyText}</p>
      ) : null}

      {buyable ? trust : null}

      <ul className="mt-5 space-y-2 text-sm">
        <li className={`flex items-center gap-2 font-bold ${buyable ? 'text-success' : 'text-warning'}`}>
          {buyable ? (
            <CheckCircle2 aria-hidden="true" className="size-4" />
          ) : (
            <Clock aria-hidden="true" className="size-4" />
          )}
          {current.availabilityText}
        </li>
        {current.deliveryText ? (
          <li className="flex items-center gap-2 text-ink">
            <Truck aria-hidden="true" className="size-4 text-muted" />
            {current.deliveryText}
          </li>
        ) : null}
      </ul>
      {!buyable && !current.priceOnRequest ? (
        <p className="mt-3 text-sm text-muted">{labels.unavailable}</p>
      ) : null}

      <div className="mt-5 max-w-md">
        {extras}
        <div className="mt-1">
          {buyable ? (
            <AddToCartButton
              key={current.sku}
              slug={slug}
              sku={current.sku}
              defaultSku={defaultSku}
              labels={cartLabels}
              className="min-h-12"
            />
          ) : (
            <a
              href={current.askHref}
              target="_blank"
              rel="noopener noreferrer"
              data-track="product_ask_whatsapp"
              className="press inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-button bg-whatsapp px-5 text-sm font-bold text-white"
            >
              <MessageCircle aria-hidden="true" className="size-4" />
              {labels.askAbout}
              <span className="sr-only"> ({labels.whatsappNote})</span>
            </a>
          )}
          {buyable && showSellerNote ? <SellerNote text={labels.sellerCannotOrder} className="mt-3" /> : null}
        </div>
      </div>
    </div>
  );
}
