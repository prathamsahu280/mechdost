/**
 * Stage timing of one sign-in attempt, for the `auth_timing` analytics event (spec 12, 2026-11-25: the staff sign-in
 * felt slow and failed sometimes, and nothing recorded where the time went). Pure and clock-injected so it is unit
 * tested; numbers only, never ids, accounts or typed text.
 */
import type { ClientEvents } from '@mechdost/shared/analytics';

export type AuthFlow = ClientEvents['auth_timing']['flow'];
export type AuthOutcome = ClientEvents['auth_timing']['outcome'];
export type TimedStage = 'botCheckMs' | 'apiMs' | 'smsSendMs' | 'codeConfirmMs' | 'finishMs';

export interface AuthTiming {
  /** Runs `work`, adding its duration to `name` (a stage that runs twice, e.g. a retry, adds up). */
  stage<T>(name: TimedStage, work: () => Promise<T>): Promise<T>;
  /** Cloudflare asked the person to do something. */
  challengeShown(): void;
  /** The Cloudflare check was not needed (a signed staff challenge stood in for it). */
  botCheckSkipped(): void;
  /** The event props (without `path`) for how this attempt ended. */
  done(outcome: AuthOutcome): Omit<ClientEvents['auth_timing'], 'path'>;
}

const whole = (ms: number) => Math.max(0, Math.min(600_000, Math.round(ms)));

export function startTiming(flow: AuthFlow, now: () => number = () => performance.now()): AuthTiming {
  const began = now();
  const stages: Partial<Record<TimedStage, number>> = {};
  let shown = false;
  let skipped = false;
  return {
    async stage(name, work) {
      const at = now();
      try {
        return await work();
      } finally {
        stages[name] = (stages[name] ?? 0) + (now() - at);
      }
    },
    challengeShown() {
      shown = true;
    },
    botCheckSkipped() {
      skipped = true;
    },
    done(outcome) {
      const out: Omit<ClientEvents['auth_timing'], 'path'> = {
        flow,
        outcome,
        totalMs: whole(now() - began),
        challengeShown: shown,
        botCheckSkipped: skipped,
      };
      for (const [name, ms] of Object.entries(stages) as [TimedStage, number][]) out[name] = whole(ms);
      return out;
    },
  };
}
