/** Shared by the server layout (pre-paint script) and the client toggle. */
export const THEME_STORAGE_KEY = 'mechdost-theme';

/**
 * Runs in <head> before first paint so a saved choice never flashes the wrong theme. Without a saved choice the
 * site opens light, whatever the device's system theme (user 2026-11-23: "open on light mode by default").
 *
 * It also keeps the choice applied (bugs 2026-11-13): React clears every attribute of `<html>` when the per-locale
 * root layout changes on the client (for example a redirect by the language cookie), so a `MutationObserver`
 * puts `data-theme` back (only when it is missing or invalid: a choice made on this page that could not be saved,
 * storage full, must stay — qa-regressions, regression of 2026-11-23); and a choice made in another tab applies here
 * too (`storage`). Inline, so it costs no
 * JavaScript bundle on any page (JS budget); allowed by hash under the nonce CSP (`csp.ts`).
 */
export const THEME_INIT_SCRIPT = `(function(){var k='${THEME_STORAGE_KEY}',r=document.documentElement;function a(){var t='light';try{var s=localStorage.getItem(k);if(s==='dark')t=s;}catch(e){}if(r.dataset.theme!==t)r.dataset.theme=t;}a();try{new MutationObserver(function(){var c=r.dataset.theme;if(c!=='dark'&&c!=='light')a();}).observe(r,{attributes:true,attributeFilter:['data-theme']});addEventListener('storage',function(e){if(e.key===k)a();});}catch(e){}})();`;
