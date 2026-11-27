/**
 * DC-B7 (QA 2026-11-27): staff "Open" links for rider documents and job photos were relative
 * (`/delivery-photos/…`), so they opened on the website and hit its 404 page. The signed image route lives on the API
 * (`{API}/v1/delivery-photos/{id}/{variant}`, spec 24 § storage); links must point there.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deliveryPhotoHref } from '../src/lib/delivery/view';

const API = 'https://api.example.test';

describe('staff photo links open on the API (DC-B7)', () => {
  it('turns the API path into an absolute API link', () => {
    expect(deliveryPhotoHref('/v1/delivery-photos/abc/large?e=1&s=x', API)).toBe(
      `${API}/v1/delivery-photos/abc/large?e=1&s=x`,
    );
  });

  it('accepts the older path without /v1 and a trailing slash on the base', () => {
    expect(deliveryPhotoHref('/delivery-photos/abc/large?e=1&s=x', `${API}/`)).toBe(
      `${API}/v1/delivery-photos/abc/large?e=1&s=x`,
    );
  });

  it('keeps an absolute link and gives nothing without an API base', () => {
    expect(deliveryPhotoHref(`${API}/v1/delivery-photos/a/large`, API)).toBe(
      `${API}/v1/delivery-photos/a/large`,
    );
    expect(deliveryPhotoHref('/v1/delivery-photos/a/large', '')).toBeNull();
  });

  it('the staff screens and the API use the /v1 image route', () => {
    const web = readFileSync(
      new URL('../src/components/delivery/admin-delivery.tsx', import.meta.url),
      'utf8',
    );
    expect(web).not.toMatch(/href=\{(p\.url|view\.photoUrl)\}/);
    expect(web.match(/deliveryPhotoHref\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    const api = readFileSync(new URL('../../api/src/routes/delivery.ts', import.meta.url), 'utf8');
    expect(api).toContain('return `/v1/delivery-photos/${mediaId}/large');
  });
});
