import type { MetadataRoute } from 'next';

/**
 * Web app manifest (PWA-ready; the service worker comes with Serwist later). Icons are built from the brand mark by
 * `apps/web/scripts/make-brand-icons.mjs`: 192/512 on white, plus maskable 192/512 on navy with the mark inside the
 * 80 % safe zone. The names are brand text (Latin on /hi too, hard rule 10).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MechDost',
    short_name: 'MechDost',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#101f34',
    icons: [
      { src: '/brand/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/brand/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
