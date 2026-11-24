/**
 * Cloudflare Turnstile in the browser (spec 13): the API refuses password sign-in without a fresh token. The
 * script loads only when a sign-in form needs it. Tokens are single use, so every call runs the check again.
 * Development uses Cloudflare's always-pass test site key (`.env.example`).
 */
import { retryOnce, tokenUsable } from './sign-in-retry';

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
/** A check that has not answered by then (blocked or slow network) fails instead of leaving the form busy;
 *  not while a visible challenge waits for the person. */
const GIVE_UP_MS = 20_000;
let loading: Promise<TurnstileApi> | null = null;
let widget: { id: string; el: HTMLElement } | null = null;
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
/** The current call's hook: the widget's callbacks are bound once, at render. */
let shown: (on: boolean) => void = () => undefined;
/** True while Cloudflare's visible challenge is on screen (a call that joins a running check learns of it). */
let interactiveNow = false;
/** Who hears "a visible challenge is up": the call that started the check, or the one that took it over. */
let listener: (on: boolean) => void = () => undefined;
/** A check started ahead of the submit (first focus in the form): the token is waiting when the button is pressed. */
let warm: { promise: Promise<string>; at: number; el: HTMLElement | null } | null = null;

/** The early check is only worth waiting for if it runs in the container on screen now (bug 2026-11-24). */
function sameContainer(held: { el: HTMLElement | null }, containerId: string): boolean {
  return held.el !== null && held.el.isConnected && held.el === document.getElementById(containerId);
}

/** Fetch the Cloudflare script now (sign-in screen opened), so the check at submit time starts at once. */
export function warmTurnstile(): void {
  load().catch(() => undefined);
}

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
 * Start the check before the person presses the button (they are still typing); `turnstileToken` then returns
 * that token at once while it is fresh. A failure here is silent: the real call just runs its own check.
 */
export function prefetchTurnstileToken(
  containerId: string,
  locale: string,
  onInteractive: (shown: boolean) => void = () => undefined,
): void {
  if (warm && tokenUsable(warm.at, Date.now()) && sameContainer(warm, containerId)) return;
  listener = onInteractive;
  const promise = run(containerId, locale);
  const mine = { promise, at: Date.now(), el: document.getElementById(containerId) };
  warm = mine;
  promise.catch(() => {
    if (warm === mine) warm = null;
  });
}

/**
 * A fresh token from the widget in `containerId` (rendered on first use; shown only if Cloudflare must ask).
 * `onInteractive(true)` fires when a visible challenge appears (the form labels it and tells the person),
 * `onInteractive(false)` when it is done. Uses the token prefetched while typing when there is one; a transient
 * widget error is retried once with a clean widget before it reaches the person.
 */
export async function turnstileToken(
  containerId: string,
  locale: string,
  onInteractive: (shown: boolean) => void = () => undefined,
): Promise<string> {
  const held = warm;
  warm = null;
  // A check started in a form that has been replaced (sign-in → "Forgot password") never answers: run a fresh one.
  if (held && tokenUsable(held.at, Date.now()) && sameContainer(held, containerId)) {
    listener = onInteractive;
    if (interactiveNow) onInteractive(true);
    try {
      return await held.promise;
    } catch {
      // fall through to a check of our own
    }
  }
  listener = onInteractive;
  return retryOnce(
    () =>
      run(containerId, locale).then(
        (t) => ({ t }),
        (e: unknown) => ({ e }),
      ),
    (r) => 'e' in r && !(r.e instanceof Error && r.e.message === 'turnstile timed out'),
  ).then((r) => {
    if ('t' in r) return r.t;
    throw r.e;
  });
}

async function run(containerId: string, locale: string): Promise<string> {
  let waitingForPerson = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      if (!waitingForPerson) reject(new Error('turnstile timed out'));
    }, GIVE_UP_MS);
  });
  try {
    return await Promise.race([
      issue(containerId, locale, (on) => {
        waitingForPerson = on;
        interactiveNow = on;
        listener(on);
      }),
      giveUp,
    ]);
  } finally {
    clearTimeout(timer);
    interactiveNow = false;
  }
}

async function issue(
  containerId: string,
  locale: string,
  onInteractive: (shown: boolean) => void,
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
      // A widget whose container already left the page is gone on Cloudflare's side too; removing it only warns.
      if (widget?.el.isConnected) api.remove(widget.id);
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
