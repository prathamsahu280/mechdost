/**
 * Admin-controlled home layout (spec 08 "Content", hard rule 8) — constants shared by server pages, the admin
 * editor and the pre-paint script. Plain module (no 'use client') so server components can import it.
 *
 * DEMO: the admin's choices live in this browser's localStorage. A tiny script in <head> turns them into CSS
 * (section order, hidden sections, featured category tiles) before first paint, so the home page stays a static
 * Server Component with no extra React JS. Phase 1 moves this to `site_sections` + ISR revalidation.
 */
export const SITE_CONFIG_KEY = 'mechdost-demo-site';

/** Reorderable home sections, in default order. The hero always comes first and cannot be hidden. */
export const HOME_SECTIONS = [
  'audiences',
  'trust',
  'categories',
  'products',
  'route',
  'service',
  'workshops',
  'faq',
  'partners',
] as const;
export type HomeSection = (typeof HOME_SECTIONS)[number];

/** Category tiles shown on the home page by default (6 of 9, from the concept). */
export const DEFAULT_FEATURED = [
  'tyres',
  'lubricants',
  'batteries',
  'bearings',
  'spareParts',
  'accessories',
] as const;

export const FEATURED_MIN = 3;
export const FEATURED_MAX = 6;

/**
 * Defines `window.__mdSiteCss(config)` (also called by the admin editor after a save, so both share one
 * implementation) and applies it once. Keys are checked against a strict pattern before they reach a selector.
 * Rules use !important so they win over utility classes regardless of stylesheet order.
 */
export const SITE_LAYOUT_SCRIPT = `(function(){
function ok(k){return typeof k==='string'&&/^[a-zA-Z]{1,24}$/.test(k);}
window.__mdSiteCss=function(c){var r='';var L=c&&c.layout;
if(L&&Array.isArray(L.order)){L.order.filter(ok).forEach(function(k,i){r+='[data-home-section="'+k+'"]{order:'+(i+1)+'!important}';});}
if(L&&Array.isArray(L.hidden)){L.hidden.filter(ok).forEach(function(k){r+='[data-home-section="'+k+'"]{display:none!important}';});}
var F=c&&c.featured;if(Array.isArray(F)&&F.length){r+='[data-home-category]{display:none!important}';F.filter(ok).forEach(function(k){r+='[data-home-category="'+k+'"]{display:block!important}';});}
var s=document.getElementById('md-site-layout');if(!s){s=document.createElement('style');s.id='md-site-layout';document.head.appendChild(s);}s.textContent=r;};
try{var raw=localStorage.getItem('${SITE_CONFIG_KEY}');if(raw)window.__mdSiteCss(JSON.parse(raw));}catch(e){}
})();`;

declare global {
  interface Window {
    __mdSiteCss?: (config: unknown) => void;
  }
}
