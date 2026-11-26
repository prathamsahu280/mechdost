/**
 * Image-safety classifier adapter (spec 23 § 10 step 4, SR-18; provider Q-U6, default none). Runs on every image
 * before it leaves quarantine. A CSAM hash match blocks publishing and seals the file in the evidence vault; an NSFW
 * score at or above `mod.nsfw_hold_score_pct` lets the file through but holds every post that uses it.
 *
 * `NoOpImageSafetyClassifier` is the default (no provider yet): it answers "not checked", and pre-moderation of new
 * accounts' media posts (the screen, `mod.premod_*`) stays the safeguard. `HashListImageSafetyClassifier` is the
 * test double for AT-UP-9 (a benign fixture on a test hash list).
 */
export interface SafetyVerdict {
  /** False when no classifier ran (the default): pre-moderation applies. */
  checked: boolean;
  hashMatch: boolean;
  /** 0–100, null when the provider gives no score. */
  nsfwScorePct: number | null;
}

export interface ImageSafetyClassifier {
  readonly id: string;
  check(input: { bytes: Uint8Array; mime: string; sha256: string }): Promise<SafetyVerdict>;
}

export class NoOpImageSafetyClassifier implements ImageSafetyClassifier {
  readonly id = 'none';
  check(): Promise<SafetyVerdict> {
    return Promise.resolve({ checked: false, hashMatch: false, nsfwScorePct: null });
  }
}

/** Test double: matches the declared sha256 against a list; optional fixed scores per sha256. */
export class HashListImageSafetyClassifier implements ImageSafetyClassifier {
  readonly id = 'test_hash_list';
  constructor(
    private readonly hashes: ReadonlySet<string>,
    private readonly scores: ReadonlyMap<string, number> = new Map(),
  ) {}
  check(input: { sha256: string }): Promise<SafetyVerdict> {
    return Promise.resolve({
      checked: true,
      hashMatch: this.hashes.has(input.sha256),
      nsfwScorePct: this.scores.get(input.sha256) ?? 0,
    });
  }
}
