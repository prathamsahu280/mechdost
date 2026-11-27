/**
 * Pehchaan tag (level chip) colours: existing token pairs only, no new colours (decisions 2026-11-27 "Pehchaan tag
 * shape"). `apps/web/test/tokens.test.ts` checks every pair at 4.5:1 in light and dark. Class names are spelled out
 * so Tailwind finds them; the coming visual-language pass swaps colours here, in one place.
 */
export const PEHCHAAN_TONES = {
  apprentice: { bg: 'pill', fg: 'ink', cls: 'bg-pill text-ink' },
  ustaad_pending: { bg: 'warning-bg', fg: 'warning', cls: 'bg-warning-bg text-warning' },
  naya: { bg: 'info-bg', fg: 'info', cls: 'bg-info-bg text-info' },
  pakka: { bg: 'success-bg', fg: 'success', cls: 'bg-success-bg text-success' },
  bada: { bg: 'accent-soft', fg: 'accent-soft-text', cls: 'bg-accent-soft text-accent-soft-text' },
  master: { bg: 'navy', fg: '#ffffff', cls: 'bg-navy text-white' },
} as const;

export type PehchaanLevel = keyof typeof PEHCHAAN_TONES;

export function pehchaanTone(level: string): (typeof PEHCHAAN_TONES)[PehchaanLevel] {
  return level in PEHCHAAN_TONES ? PEHCHAAN_TONES[level as PehchaanLevel] : PEHCHAAN_TONES.apprentice;
}
