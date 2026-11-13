/** Shared by the server layout (pre-paint script) and the client toggle. */
export const THEME_STORAGE_KEY = 'mechdost-theme';

/**
 * Runs in <head> before first paint so a saved choice never flashes the wrong theme. Without a saved choice the
 * CSS follows the system preference, so first-time visitors need no saved value at all.
 *
 * It also keeps the choice applied (bugs 2026-11-13): React clears every attribute of `<html>` when the per-locale
 * root layout changes on the client (for example a redirect by the language cookie), so a `MutationObserver`
 * puts `data-theme` back; and a choice made in another tab applies here too (`storage`). Inline, so it costs no
 * JavaScript bundle on any page (JS budget); allowed by hash under the nonce CSP (`csp.ts`).
 */
export const THEME_INIT_SCRIPT = `(function(){var k='${THEME_STORAGE_KEY}',r=document.documentElement;function a(){try{var t=localStorage.getItem(k);if((t==='dark'||t==='light')&&r.dataset.theme!==t)r.dataset.theme=t;}catch(e){}}a();try{new MutationObserver(a).observe(r,{attributes:true,attributeFilter:['data-theme']});addEventListener('storage',function(e){if(e.key===k)a();});}catch(e){}})();`;
