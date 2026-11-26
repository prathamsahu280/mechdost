/**
 * Learn progress (spec 23 § 21b): the player reports seconds actually watched as a heartbeat (`deltaSeconds`, 1–300)
 * every 15 s while a video plays. The meter counts only time between play and pause, never seeks, and carries the
 * fraction of a second to the next heartbeat so nothing is lost or counted twice.
 */
export const HEARTBEAT_MS = 15_000;
const MAX_DELTA_S = 300;

export interface WatchMeter {
  play(now: number): void;
  pause(now: number): void;
  /** Whole seconds watched since the last take (null when under one second), at most 300. */
  take(now: number): number | null;
}

export function createWatchMeter(): WatchMeter {
  let playingSince: number | null = null;
  let banked = 0;
  const settle = (now: number) => {
    if (playingSince !== null) {
      banked += Math.max(0, now - playingSince);
      playingSince = now;
    }
  };
  return {
    play(now) {
      settle(now);
      playingSince ??= now;
    },
    pause(now) {
      settle(now);
      playingSince = null;
    },
    take(now) {
      settle(now);
      const whole = Math.floor(banked / 1000);
      if (whole < 1) return null;
      // Seconds above the cap are dropped (the server caps the credit too).
      banked -= whole * 1000;
      return Math.min(whole, MAX_DELTA_S);
    },
  };
}
