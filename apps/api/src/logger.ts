/**
 * Structured JSON logs (Cloud Logging reads `severity`). Never log tokens, phone numbers, emails or bodies
 * (docs/research/security-vulnerabilities.md #26) — callers pass ids and codes only.
 */
let sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`);

/** Tests capture or silence logs. */
export function setLogSink(next: (line: string) => void) {
  sink = next;
}

export type Severity = 'debug' | 'info' | 'warn' | 'error';
export type ErrorHook = (message: string, fields: Record<string, unknown>) => void;
let errorHook: ErrorHook | null = null;

/** Error lines also go to the error reporter (Sentry, `monitoring/sentry.ts`) when one is set; null removes it. */
export function setErrorHook(next: ErrorHook | null) {
  errorHook = next;
}

export function log(severity: Severity, message: string, fields: Record<string, unknown> = {}) {
  sink(
    JSON.stringify({ severity: severity.toUpperCase(), message, time: new Date().toISOString(), ...fields }),
  );
  if (severity === 'error' && errorHook) {
    try {
      errorHook(message, fields);
    } catch {
      // Reporting never breaks the caller.
    }
  }
}

/**
 * Loggable view of an error (security review 2026-11-03): its class, the Postgres SQLSTATE if any, and the
 * stack *frames* only. Never the message: database errors embed the failed query and its parameters (phone
 * numbers, message text), and provider errors can echo request bodies.
 */
export function safeError(err: unknown): { errorName: string; pgCode?: string; frames?: string } {
  const name = err instanceof Error ? err.name : typeof err;
  let code: string | undefined;
  let e: unknown = err;
  for (let i = 0; i < 4 && e && typeof e === 'object'; i += 1) {
    const c = (e as { code?: unknown }).code;
    if (typeof c === 'string' && /^[0-9A-Z]{5}$/.test(c)) {
      code = c;
      break;
    }
    e = (e as { cause?: unknown }).cause;
  }
  const frames =
    err instanceof Error && err.stack
      ? err.stack
          .split('\n')
          .filter((line) => line.trimStart().startsWith('at '))
          .slice(0, 8)
          .join('\n')
      : undefined;
  return { errorName: name, ...(code ? { pgCode: code } : {}), ...(frames ? { frames } : {}) };
}
