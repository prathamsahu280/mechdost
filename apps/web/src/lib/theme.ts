/** Shared by the server layout (pre-paint script) and the client toggle. */
export const THEME_STORAGE_KEY = 'mechdost-theme';

/**
 * Runs in <head> before first paint so the page never flashes the wrong theme. An explicit choice saved under
 * `mechdost-theme` wins; without one the site follows the device (`prefers-color-scheme`) and switches live when the
 * device does (founder 2026-11-27 night, replaces "light by default" of 2026-11-23). Without `matchMedia` it opens
 * light.
 *
 * It also keeps the theme applied (bugs 2026-11-13): React clears every attribute of `<html>` when the per-locale
 * root layout changes on the client (for example a redirect by the language cookie), so a `MutationObserver`
 * puts `data-theme` back (only when it is missing or invalid: a choice made on this page that could not be saved,
 * storage full, must stay — qa-regressions, regression of 2026-11-23); and a choice made in another tab applies here
 * too (`storage`). Inline, so it costs no JavaScript bundle on any page (JS budget); allowed by hash under the nonce
 * CSP (`csp.ts`).
 */
export const THEME_INIT_SCRIPT = `(function(){var k='${THEME_STORAGE_KEY}',r=document.documentElement,m=null;try{m=matchMedia('(prefers-color-scheme: dark)');}catch(e){}function s(){try{var v=localStorage.getItem(k);if(v==='dark'||v==='light')return v;}catch(e){}return null;}function a(){var t=s()||(m&&m.matches?'dark':'light');if(r.dataset.theme!==t)r.dataset.theme=t;}a();try{new MutationObserver(function(){var c=r.dataset.theme;if(c!=='dark'&&c!=='light')a();}).observe(r,{attributes:true,attributeFilter:['data-theme']});addEventListener('storage',function(e){if(e.key===k)a();});if(m)m.addEventListener('change',function(){if(!s())a();});}catch(e){}})();`;
