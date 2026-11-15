/**
 * Job photos on the website (spec 06 "Job photos"): every error code the API can return reads as a translated message
 * in both languages, the viewer never imports an API client (the customer page and the workshop page stay light),
 * pictures only ever come from API-issued URLs, and the CSP lets the page load them from the API origin.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PHOTO_ERROR_CODES } from '@mechdost/shared/service-photos';
import { contentSecurityPolicy } from '../src/lib/csp';
import { photoErrorKey } from '../src/lib/photos-api';
import { serviceErrorKey } from '../src/lib/service-views';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('photo error messages', () => {
  it('maps every API photo error to a message that exists in English and Hindi', () => {
    for (const code of PHOTO_ERROR_CODES) {
      if (code === 'PHOTOS_REQUIRED') {
        // the gate is a job-step error, shown by the step through the request namespace
        const key = serviceErrorKey(code) as keyof typeof en.request;
        expect(en.request[key]).toBeTruthy();
        expect(hi.request[key]).toBeTruthy();
        continue;
      }
      const key = photoErrorKey(code) as keyof typeof en.photos;
      expect(en.photos[key], code).toBeTruthy();
      expect(hi.photos[key], code).toBeTruthy();
    }
    for (const alias of ['RATE_LIMITED', 'HTTP_413', 'NETWORK', 'weird']) {
      const key = photoErrorKey(alias) as keyof typeof en.photos;
      expect(en.photos[key], alias).toBeTruthy();
      expect(hi.photos[key], alias).toBeTruthy();
    }
  });

  it('English and Hindi carry the same photo keys', () => {
    expect(Object.keys(hi.photos).sort()).toEqual(Object.keys(en.photos).sort());
  });
});

describe('import graph and image source', () => {
  it('the viewer imports no API client; the panels load it only on demand', () => {
    const viewer = read('../src/components/photos/photo-viewer.tsx');
    expect(viewer).not.toMatch(/photos-api|admin-api|orders-api|firebase/);
    for (const file of ['job-photos-panel', 'job-photos-strip', 'workshop-gallery']) {
      const src = read(`../src/components/photos/${file}.tsx`);
      expect(src, file).not.toMatch(/from '@\/lib\/(photos-api|admin-api|orders-api)'/);
      expect(src, file).not.toMatch(/firebase/);
    }
  });

  it('the three call sites load the photo screens only through the lazy wrapper (JS budget)', () => {
    for (const file of [
      '../src/components/portal/workshop-portal-api.tsx',
      '../src/components/workshops/request-view-api.tsx',
      '../src/components/workshops/workshop-profile-api.tsx',
    ]) {
      const src = read(file);
      expect(src, file).toContain('photos/photos-lazy');
      expect(src, file).not.toMatch(/photos\/(job-photos|workshop-gallery|photo-viewer)/);
    }
    // nothing the header, layout or shop pages load imports the photo code
    for (const file of ['../src/components/site/header.tsx', '../src/app/[locale]/layout.tsx']) {
      expect(read(file), file).not.toMatch(/components\/photos|photos-api|photo-src/);
    }
  });

  it('pictures are served by the API only: no storage host or key appears in the web source', () => {
    for (const file of ['photo-viewer', 'job-photos-panel', 'job-photos-strip', 'workshop-gallery']) {
      expect(read(`../src/components/photos/${file}.tsx`), file).not.toMatch(/supabase|storage\/v1|SECRET/i);
    }
    expect(read('../src/lib/photo-src.ts')).toContain('/v1');
  });

  it('the policy lets pages load images from the API origin and nothing broader', () => {
    const csp = contentSecurityPolicy({
      dev: false,
      authMode: 'firebase',
      apiUrl: 'https://api.mechdost.com/v1',
      firebaseAuthDomain: 'x.firebaseapp.com',
      authEmulatorHost: undefined,
      sentryDsn: undefined,
    });
    const img = /img-src ([^;]*)/.exec(csp)?.[1] ?? '';
    expect(img).toContain('https://api.mechdost.com');
    expect(img).not.toContain('*');
  });
});
