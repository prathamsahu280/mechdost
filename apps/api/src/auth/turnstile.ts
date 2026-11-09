/**
 * Cloudflare Turnstile (spec 13 "Abuse protection"): the browser solves a mostly invisible challenge, the API
 * checks the token once with Cloudflare. Injected so tests never call Cloudflare. Development uses Cloudflare's
 * published test secret (always passes); production needs the real secret (config).
 */
export interface TurnstileVerifier {
  /** True when Cloudflare accepts `token`; throws when Cloudflare cannot answer (the caller fails closed). */
  verify(token: string, ip: string): Promise<boolean>;
}

export function createTurnstileVerifier(secret: string): TurnstileVerifier {
  return {
    async verify(token, ip) {
      const form = new URLSearchParams({ secret, response: token });
      if (ip !== 'unknown') form.set('remoteip', ip);
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`turnstile siteverify ${String(res.status)}`);
      const body = (await res.json()) as { success?: boolean };
      return body.success === true;
    },
  };
}
