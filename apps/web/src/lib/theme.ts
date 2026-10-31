/** Shared by the server layout (pre-paint script) and the client toggle. */
export const THEME_STORAGE_KEY = 'mechdost-theme';

/**
 * Runs in <head> before first paint so a saved choice never flashes the wrong theme. Without a saved choice the
 * CSS follows the system preference, so first-time visitors need no script at all.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;}catch(e){}})();`;
