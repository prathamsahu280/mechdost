/**
 * Admin sizes (variants) API (user 2026-11-24): `products:write` staff add, edit and archive the sizes of a product;
 * strict bodies (no mass assignment), compare-and-set on the size's version, and archive/restore needs
 * `products:publish` because it changes what customers see.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedRaipurDemo, type DemoFixture } from '@mechdost/db/demo-seed';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import { bearer, buildApp, type ErrorJson } from './helpers';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../packages/db/seed/raipur-demo.json', import.meta.url)), 'utf8'),
) as DemoFixture;
const SLUG = 'castrol-activ-4t-20w40-900ml';

let ctx: Awaited<ReturnType<typeof buildApp>>;

async function staff(n: string, role: string) {
  const phone = `+9198777777${n}`;
  const identity = {
    firebaseUid: `cv-${n}`,
    phone,
    email: `cv-${n}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-catalogue-var-0${n}`, identity);
  const user = await ensureUser(ctx.db, identity);
  await grantRole(ctx.db, { userId: user.id, role, grantedBy: null });
  return { ...bearer(token), 'content-type': 'application/json' };
}

const send = (h: Record<string, string>, method: string, path: string, body?: unknown) =>
  ctx.app.request(`/v1${path}`, {
    method,
    headers: h,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

beforeAll(async () => {
  ctx = await buildApp();
  await seedRaipurDemo(ctx.db, fixture);
});

describe('admin sizes API', () => {
  it('adds a size, lists it with its label and version, and refuses a taken SKU', async () => {
    const manager = await staff('01', 'catalogue_manager');
    const add = await send(manager, 'POST', `/admin/catalogue/products/${SLUG}/variants`, {
      sku: 'CAS-API-2000',
      options: { size: '2 L' },
      mrpPaise: 190_000,
      barcode: '8901234567890',
    });
    expect(add.status).toBe(201);
    expect(await add.json()).toEqual({ sku: 'CAS-API-2000', version: 1 });
    const detail = (await (await send(manager, 'GET', `/admin/catalogue/products/${SLUG}`)).json()) as {
      variants: { sku: string; label: string; status: string; version: number; barcode: string | null }[];
    };
    expect(detail.variants.find((v) => v.sku === 'CAS-API-2000')).toMatchObject({
      label: '2 L',
      status: 'active',
      version: 1,
      barcode: '8901234567890',
    });
    const again = await send(manager, 'POST', `/admin/catalogue/products/${SLUG}/variants`, {
      sku: 'CAS-API-2000',
      options: { size: '2 L' },
      mrpPaise: 190_000,
    });
    expect(again.status).toBe(409);
    expect(((await again.json()) as ErrorJson).error.code).toBe('SKU_TAKEN');
  });

  it('refuses unknown fields (no mass assignment) and other roles', async () => {
    const manager = await staff('02', 'catalogue_manager');
    const marketing = await staff('03', 'marketing');
    const body = { sku: 'CAS-API-3000', options: { size: '3 L' }, mrpPaise: 1000 };
    expect(
      (await send(manager, 'POST', `/admin/catalogue/products/${SLUG}/variants`, { ...body, status: 'live' }))
        .status,
    ).toBe(400);
    expect(
      (
        await send(manager, 'POST', `/admin/catalogue/products/${SLUG}/variants`, {
          ...body,
          options: { evil: 'x' },
        })
      ).status,
    ).toBe(400);
    expect((await send(marketing, 'POST', `/admin/catalogue/products/${SLUG}/variants`, body)).status).toBe(
      403,
    );
    expect((await send({}, 'POST', `/admin/catalogue/products/${SLUG}/variants`, body)).status).toBe(401);
  });

  it('edits with the version; a stale save is a 409', async () => {
    const manager = await staff('04', 'catalogue_manager');
    const ok = await send(manager, 'PATCH', '/admin/catalogue/variants/CAS-API-2000', {
      version: 1,
      options: { size: '2 L can' },
      mrpPaise: 195_000,
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ sku: 'CAS-API-2000', version: 2 });
    const stale = await send(manager, 'PATCH', '/admin/catalogue/variants/CAS-API-2000', {
      version: 1,
      mrpPaise: 100_000,
    });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as ErrorJson).error.code).toBe('STALE_VARIANT');
    expect(
      (await send(manager, 'PATCH', '/admin/catalogue/variants/CAS-API-2000', { version: 2, productId: 'x' }))
        .status,
    ).toBe(400);
  });

  it('archives and restores a size (the answer carries the new version)', async () => {
    const manager = await staff('05', 'catalogue_manager');
    const archived = await send(manager, 'PATCH', '/admin/catalogue/variants/CAS-API-2000', {
      version: 2,
      status: 'archived',
    });
    expect(archived.status).toBe(200);
    expect(await archived.json()).toEqual({ sku: 'CAS-API-2000', version: 3 });
    const restored = await send(manager, 'PATCH', '/admin/catalogue/variants/CAS-API-2000', {
      version: 3,
      status: 'active',
    });
    expect(restored.status).toBe(200);
    // Back on the public page once restored.
    const page = (await (await ctx.app.request(`/v1/catalogue/products/${SLUG}?locale=en`)).json()) as {
      variants: { sku: string }[];
    };
    expect(page.variants.map((v) => v.sku)).toContain('CAS-API-2000');
  });
});
