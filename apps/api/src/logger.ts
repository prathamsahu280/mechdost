/**
 * Structured JSON logs (Cloud Logging reads `severity`). Never log tokens, phone numbers, emails or bodies
 * (docs/research/security-vulnerabilities.md #26) — callers pass ids and codes only.
 */
type Severity = 'debug' | 'info' | 'warn' | 'error';

let sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`);

/** Tests capture or silence logs. */
export function setLogSink(next: (line: string) => void) {
  sink = next;
}

export function log(severity: Severity, message: string, fields: Record<string, unknown> = {}) {
  sink(
    JSON.stringify({ severity: severity.toUpperCase(), message, time: new Date().toISOString(), ...fields }),
  );
}
