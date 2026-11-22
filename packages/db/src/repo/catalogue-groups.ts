import { and, eq, sql } from 'drizzle-orm';
import { isHideReason, type HideReason } from '@mechdost/shared/catalogue-groups';
import { auditLog, brands, productRanges } from '../schema';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import { num, rowsOf } from './sql-rows';
import { productVisible } from './visibility';

/**
 * Brand and range switches (design 2026-11-22; spec 02 and 08; hard rule 8): the admin turns a brand or a product
 * range off for the whole storefront in one action. Hiding never rewrites a product's own status: switching back
 * restores exactly what was live. Every switch needs a reason code, is a compare-and-set on `version` (a stale screen
 * gets 409) and is audited with before/after and the number of products it moved. `products:write` is checked by the
 * API; unknown slugs are 404.
 */
export interface GroupRow {
  slug: string;
  name: string;
  hidden: boolean;
  hiddenReason: HideReason | null;
  version: number;
  /** All products of the group, whatever their status. */
  products: number;
  /** Products customers can see right now (the one visibility rule, counting only this group's own switch). */
  liveProducts: number;
  /** Packs without an MRP ("price on request"). */
  missingMrpPacks: number;
}

export interface BrandGroup extends GroupRow {
  ranges: (GroupRow & { nameHi: string | null })[];
}

interface Raw {
  slug: string;
  name: string;
  name_hi: string | null;
  hidden: boolean;
  hidden_reason: string | null;
  version: unknown;
  products: unknown;
  live: unknown;
  missing: unknown;
  brand_slug: string | null;
}

const reasonOf = (r: string | null): HideReason | null => (isHideReason(r) ? r : null);

function toGroup(r: Raw): GroupRow {
  return {
    slug: r.slug,
    name: r.name,
    hidden: r.hidden,
    hiddenReason: reasonOf(r.hidden_reason),
    version: num(r.version),
    products: num(r.products),
    liveProducts: num(r.live),
    missingMrpPacks: num(r.missing),
  };
}

/** Every brand with its ranges, product counts and missing-MRP counts, in name order (admin screen). */
export async function listBrandGroups(db: Tx): Promise<BrandGroup[]> {
  const brandRows = rowsOf<Raw>(
    await db.execute(sql`
      select b.slug, b.name, null::text as name_hi, b.hidden, b.hidden_reason, b.version,
        (select count(*) from products p where p.brand_id = b.id) as products,
        (select count(*) from products p where p.brand_id = b.id and p.status = 'live') as live,
        (select count(*) from product_variants v join products p on p.id = v.product_id
          where p.brand_id = b.id and v.status = 'active' and v.mrp_paise is null) as missing,
        null::text as brand_slug
      from brands b order by lower(b.name), b.slug`),
  );
  const rangeRows = rowsOf<Raw>(
    await db.execute(sql`
      select r.slug, r.name, r.name_hi, r.hidden, r.hidden_reason, r.version,
        (select count(*) from products p where p.range_id = r.id) as products,
        (select count(*) from products p where p.range_id = r.id and p.status = 'live') as live,
        (select count(*) from product_variants v join products p on p.id = v.product_id
          where p.range_id = r.id and v.status = 'active' and v.mrp_paise is null) as missing,
        b.slug as brand_slug
      from product_ranges r join brands b on b.id = r.brand_id order by r.sort, lower(r.name), r.slug`),
  );
  const byBrand = new Map<string, (GroupRow & { nameHi: string | null })[]>();
  for (const r of rangeRows) {
    const list = byBrand.get(r.brand_slug ?? '') ?? [];
    list.push({ ...toGroup(r), nameHi: r.name_hi });
    byBrand.set(r.brand_slug ?? '', list);
  }
  return brandRows.map((b) => ({ ...toGroup(b), ranges: byBrand.get(b.slug) ?? [] }));
}

export interface GroupSwitchInput {
  slug: string;
  hidden: boolean;
  reasonCode: HideReason | null;
  expectedVersion: number;
  staffUserId: string;
}

export interface GroupSwitched {
  version: number;
  hidden: boolean;
  hiddenReason: HideReason | null;
  /** Products whose storefront visibility changed because of this switch. */
  productsAffected: number;
}

function assertReason(input: GroupSwitchInput): void {
  if (input.hidden && !isHideReason(input.reasonCode))
    throw new ValidationError('Choose a reason before hiding', 'REASON_CODE');
}

/**
 * Hide or show a brand. Counts the products that were visible before (hide) or become visible (show), so the audit
 * row and the confirmation say what actually moved. One transaction: the conditional UPDATE is the lock.
 */
export async function setBrandHidden(db: Tx, input: GroupSwitchInput): Promise<GroupSwitched> {
  assertReason(input);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(brands).where(eq(brands.slug, input.slug)).limit(1);
    if (!row) throw new NotFoundError('Brand not found');
    const affected = await countAffected(tx, 'brand', row.id, input.hidden);
    const [done] = await tx
      .update(brands)
      .set({ hidden: input.hidden, hiddenReason: input.hidden ? input.reasonCode : null })
      .where(and(eq(brands.id, row.id), eq(brands.version, input.expectedVersion)))
      .returning({ version: brands.version });
    if (!done) throw new ConflictError('Someone else changed this brand; reload', 'STALE_GROUP');
    await audit(tx, 'brand', row.id, row.hidden, row.hiddenReason, input, affected);
    return {
      version: done.version,
      hidden: input.hidden,
      hiddenReason: input.hidden ? input.reasonCode : null,
      productsAffected: affected,
    };
  });
}

export async function setRangeHidden(db: Tx, input: GroupSwitchInput): Promise<GroupSwitched> {
  assertReason(input);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(productRanges).where(eq(productRanges.slug, input.slug)).limit(1);
    if (!row) throw new NotFoundError('Range not found');
    const affected = await countAffected(tx, 'range', row.id, input.hidden);
    const [done] = await tx
      .update(productRanges)
      .set({ hidden: input.hidden, hiddenReason: input.hidden ? input.reasonCode : null })
      .where(and(eq(productRanges.id, row.id), eq(productRanges.version, input.expectedVersion)))
      .returning({ version: productRanges.version });
    if (!done) throw new ConflictError('Someone else changed this range; reload', 'STALE_GROUP');
    await audit(tx, 'range', row.id, row.hidden, row.hiddenReason, input, affected);
    return {
      version: done.version,
      hidden: input.hidden,
      hiddenReason: input.hidden ? input.reasonCode : null,
      productsAffected: affected,
    };
  });
}

/**
 * Products whose visibility flips with this switch: when hiding, the group's currently visible products; when
 * showing, the group's live products that nothing else (another switch, a hidden category) keeps off the storefront.
 */
async function countAffected(tx: Tx, kind: 'brand' | 'range', id: string, hiding: boolean): Promise<number> {
  const own = kind === 'brand' ? sql`p.brand_id = ${id}` : sql`p.range_id = ${id}`;
  const [row] = rowsOf<{ n: unknown }>(
    hiding
      ? await tx.execute(sql`select count(*) as n from products p where ${own} and ${productVisible('p')}`)
      : await tx.execute(sql`
          select count(*) as n from products p where ${own} and p.status = 'live'
            and not exists (select 1 from categories vc left join categories vpc on vpc.id = vc.parent_id
              where vc.id = p.category_id and (vc.hidden or vc.archived_at is not null or vpc.hidden or vpc.archived_at is not null))
            and ${kind === 'brand' ? sql`not exists (select 1 from product_ranges vr where vr.id = p.range_id and vr.hidden)` : sql`not exists (select 1 from brands vb where vb.id = p.brand_id and vb.hidden)`}`),
  );
  return num(row?.n ?? 0);
}

async function audit(
  tx: Tx,
  kind: 'brand' | 'range',
  id: string,
  wasHidden: boolean,
  wasReason: string | null,
  input: GroupSwitchInput,
  affected: number,
): Promise<void> {
  await tx.insert(auditLog).values({
    actorUserId: input.staffUserId,
    actorRole: 'staff',
    action: input.hidden ? `${kind}.hidden` : `${kind}.shown`,
    entity: kind === 'brand' ? 'brand' : 'product_range',
    entityId: id,
    before: { hidden: wasHidden, reasonCode: wasReason },
    after: {
      hidden: input.hidden,
      reasonCode: input.hidden ? input.reasonCode : null,
      productsAffected: affected,
    },
    reason: input.hidden ? input.reasonCode : null,
  });
  await recordServerEvent(tx, 'admin_group_switched', {
    userId: input.staffUserId,
    props: {
      kind,
      slug: input.slug,
      hidden: input.hidden,
      reasonCode: input.hidden ? input.reasonCode : null,
      productsAffected: affected,
    },
  });
}
