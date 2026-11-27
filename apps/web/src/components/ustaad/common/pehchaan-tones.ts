/**
 * Pehchaan tag (level chip) finishes — visual direction A "Bench kit" (decision 2026-11-27 night; visual language
 * doc § 3.3): Chhotu an outline tag, Ustaad-to-verify hatched, Naya zinc, Pakka brass, Bada copper, Master ink; every
 * tag has a 1 px edge (non-text contrast) and 0–4 grade lines, and always prints the word (colour is never the only
 * cue). Tokens only (`zinc`, `brass`, `brass-text` added with this decision). `apps/web/test/tokens.test.ts` checks
 * text on fill (4.5:1) and edge on surface (3:1) in light and dark. Class names are spelled out so Tailwind finds them.
 */
export const PEHCHAAN_TONES = {
  apprentice: {
    fill: 'surface',
    fg: 'ink',
    edge: 'input-border',
    lines: 0,
    cls: { fill: 'bg-surface text-ink', edge: 'bg-input-border' },
  },
  ustaad_pending: {
    fill: 'surface',
    fg: 'ink',
    edge: 'input-border',
    lines: 0,
    cls: {
      fill: 'bg-surface text-ink bg-[repeating-linear-gradient(135deg,var(--color-pill)_0_4px,var(--color-surface)_4px_8px)]',
      edge: 'bg-input-border',
    },
  },
  naya: {
    fill: 'zinc',
    fg: 'ink',
    edge: 'input-border',
    lines: 1,
    cls: {
      fill: 'bg-zinc bg-[linear-gradient(180deg,var(--color-naya-top),var(--color-naya-bottom))] text-ink',
      edge: 'bg-input-border',
    },
  },
  pakka: {
    fill: 'brass',
    fg: 'navy',
    edge: 'brass-text',
    lines: 2,
    cls: {
      fill: 'bg-brass bg-[linear-gradient(180deg,var(--color-pakka-top),var(--color-pakka-bottom))] text-navy',
      edge: 'bg-brass-text',
    },
  },
  bada: {
    fill: 'accent-button',
    fg: '#ffffff',
    edge: 'accent-button-hover',
    lines: 3,
    cls: { fill: 'bg-accent-button text-white', edge: 'bg-accent-button-hover' },
  },
  master: {
    fill: 'ink',
    fg: 'surface',
    edge: 'accent',
    lines: 4,
    cls: {
      fill: 'bg-ink bg-[linear-gradient(180deg,var(--color-master-top),var(--color-master-bottom))] text-surface',
      edge: 'bg-accent',
    },
  },
} as const;

export type PehchaanLevel = keyof typeof PEHCHAAN_TONES;

export function pehchaanTone(level: string): (typeof PEHCHAAN_TONES)[PehchaanLevel] {
  return level in PEHCHAAN_TONES ? PEHCHAAN_TONES[level as PehchaanLevel] : PEHCHAAN_TONES.apprentice;
}
