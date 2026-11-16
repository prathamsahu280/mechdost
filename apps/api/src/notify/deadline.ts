/** A step of the dispatcher (claim, a send-time loader, the provider call, recording) ran past its deadline. */
export class PhaseTimeoutError extends Error {
  constructor(readonly phase: string) {
    super(`phase_timeout:${phase}`);
    this.name = 'PhaseTimeoutError';
  }
}

/**
 * Rejects with `PhaseTimeoutError(phase)` when `work` has not settled within `ms`. The work itself cannot be
 * cancelled from here (the database side is bounded by `withStatementTimeout`), so callers must be safe to
 * ignore its late result (worker incident 2026-11-16: an unbounded loader query held a tick for 120 s).
 */
export function withDeadline<T>(ms: number, phase: string, work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new PhaseTimeoutError(phase));
    }, ms);
    work().then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error('unexpected'));
      },
    );
  });
}
