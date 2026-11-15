import { asc, eq } from 'drizzle-orm';
import { maskPhone } from '@mechdost/shared/contact-mask';
import { orderItems, orders, pincodes, shops } from '../schema';
import { ConflictError, NotFoundError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';

/**
 * The packing slip (design 2026-11-15 item 5; decisions: first name and masked phone, Q99 pending, own delivery, GST
 * invoice waits on Q97, so the slip is not an invoice). Data for the printable A5 page: order code, items and
 * quantities, the delivery PIN and area, the customer's FIRST name and the phone with all but the last four digits
 * hidden. No prices, no street address, no delivery code. Only for an order the caller's shop is fulfilling
 * (confirmed to out for delivery): the customer's details are shared no earlier (DPDP minimisation, spec 13); any
 * other shop's order is a 404.
 */
const FULFILLING = ['confirmed', 'packed', 'shipped', 'out_for_delivery'];

const firstName = (full: string): string => full.trim().split(/\s+/)[0]?.slice(0, 30) ?? '';

export async function getPackingSlip(
  db: Tx,
  input: { shopIds: readonly string[]; code: string; userId: string },
) {
  const [o] = await db
    .select({
      id: orders.id,
      code: orders.code,
      status: orders.status,
      shopId: orders.shopId,
      cityId: orders.cityId,
      placedAt: orders.placedAt,
      pincode: orders.pincode,
      address: orders.shippingAddress,
    })
    .from(orders)
    .where(eq(orders.code, input.code))
    .limit(1);
  const shopId = o?.shopId;
  if (!o || !shopId || !input.shopIds.includes(shopId)) throw new NotFoundError('Order not found');
  if (!FULFILLING.includes(o.status))
    throw new ConflictError('The slip is for orders your shop is packing or delivering', 'SLIP_UNAVAILABLE');
  const [shop] = await db
    .select({ name: shops.name, nameHi: shops.nameHi })
    .from(shops)
    .where(eq(shops.id, shopId));
  const [area] = await db
    .select({ locality: pincodes.locality, localityHi: pincodes.localityHi })
    .from(pincodes)
    .where(eq(pincodes.pincode, o.pincode));
  const items = await db
    .select({
      title: orderItems.title,
      titleHi: orderItems.titleHi,
      sku: orderItems.sku,
      qty: orderItems.qty,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, o.id))
    .orderBy(asc(orderItems.sku));
  const a: Record<string, unknown> =
    typeof o.address === 'object' && o.address !== null ? (o.address as Record<string, unknown>) : {};
  const name = typeof a.contactName === 'string' ? a.contactName : '';
  const phone = typeof a.contactPhone === 'string' ? a.contactPhone : null;
  await recordServerEvent(db, 'shop_packing_slip_viewed', {
    userId: input.userId,
    cityId: o.cityId,
    props: { shopId, orderCode: o.code },
  });
  return {
    code: o.code,
    placedAt: o.placedAt.toISOString(),
    shopName: shop?.name ?? '',
    shopNameHi: shop?.nameHi ?? null,
    items,
    pincode: o.pincode,
    area: area?.locality ?? null,
    areaHi: area?.localityHi ?? null,
    firstName: firstName(name),
    phoneMasked: maskPhone(phone) ?? '',
  };
}
