/**
 * Class constants for the Me / card area (U4, design § 3.8). Tokens only, no raw colours, so the coming Ustaad
 * visual-language pass can swap colours and motion here in one place. Motion: `motion-safe:` and transform/opacity
 * only.
 */

/** The shared button base (sizes and focus ring); pair it with one of the fills below. */
export const btnBase =
  'press inline-flex min-h-12 items-center justify-center gap-2 rounded-button px-5 text-base font-bold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';
export const btnFillPrimary = 'bg-accent-button text-white hover:bg-accent-button-hover';
export const btnOutline = 'border border-line-card bg-surface text-ink hover:bg-pill';
export const btnOnNavy = 'bg-white text-navy';

/** Section heading on Me. */
export const sectionH = 'font-heading text-xl font-extrabold text-ink';

/** Grouped content panel (cards stay for grouped content; design principle 4). */
export const panel = 'rounded-card border border-line-card bg-surface p-4';

/** Native `<progress>` styled with tokens (WebKit and Firefox parts). */
export const progressBar =
  'h-2.5 w-full appearance-none overflow-hidden rounded-full bg-pill [&::-webkit-progress-bar]:bg-pill [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-accent-button [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-accent-button';

/** The weekly helped note: a positive, quiet strip. */
export const helpedNote = 'rounded-card bg-success-bg px-4 py-3 text-success';

/** Bottom sheet on phones, centred dialog from tablet up; backdrop from tokens. */
export const sheet =
  'm-0 mt-auto max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-dialog border border-line-card bg-surface p-5 text-ink shadow-dialog backdrop:bg-navy/60 tab:m-auto tab:max-w-lg tab:rounded-dialog motion-safe:transition-opacity';
