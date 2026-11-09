/**
 * Cloudflare Turnstile in the browser (spec 13): the API refuses password sign-in without a fresh token. The
 * script loads only when a sign-in form needs it. Tokens are single use, so every call runs the check again.
 * Development uses Cloudflare's always-pass test site key (`.env.example`).
 */
interface TurnstileApi {
  render(
    el: HTMLElement,
    opts: {
      sitekey: string;
      execution: 'execute';
      appearance: 'interaction-only';
      language: string;
      callback: (token: string) => void;
      'error-callback': () => void;
      'before-interactive-callback': () => void;
      'after-interactive-callback': () => void;
    },
  ): string;
  execute(widgetId: string): void;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading: Promise<TurnstileApi> | null = null;
let widget: { id: string; el: HTMLElement } | null = null;
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
/** The current call's hook: the widget's callbacks are bound once, at render. */
let shown: (on: boolean) => void = () => undefined;

function load(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('turnstile missing'));
    };
    s.onerror = () => {
      loading = null;
      reject(new Error('turnstile failed to load'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * A fresh token from the widget in `containerId` (rendered on first use; shown only if Cloudflare must ask).
 * `onInteractive(true)` fires when a visible challenge appears (the form labels it and tells the person),
 * `onInteractive(false)` when it is done.
 */
export async function turnstileToken(
  containerId: string,
  locale: string,
  onInteractive: (shown: boolean) => void = () => undefined,
): Promise<string> {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!siteKey) throw new Error('turnstile not configured');
  const api = await load();
  const el = document.getElementById(containerId);
  if (!el) throw new Error('turnstile container missing');
  return new Promise<string>((resolve, reject) => {
    pending?.reject(new Error('superseded'));
    pending = { resolve, reject };
    shown = onInteractive;
    if (widget?.el !== el) {
      if (widget) api.remove(widget.id);
      widget = {
        el,
        id: api.render(el, {
          sitekey: siteKey,
          execution: 'execute',
          appearance: 'interaction-only',
          language: locale,
          callback: (token) => {
            pending?.resolve(token);
            pending = null;
          },
          'error-callback': () => {
            pending?.reject(new Error('turnstile error'));
            pending = null;
          },
          'before-interactive-callback': () => {
            el.scrollIntoView({ block: 'nearest' });
            shown(true);
          },
          'after-interactive-callback': () => {
            shown(false);
          },
        }),
      };
    } else {
      api.reset(widget.id);
    }
    api.execute(widget.id);
  });
}
