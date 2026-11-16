/**
 * What the header avatar circle shows (QA 2026-11-16, bug 11): the first letter of the person's first name, or null
 * for an account without a name (the circle then shows the neutral person icon). Tiny and pure: it ships in the header.
 */
export function avatarMark(name: string): { first: string; initial: string | null } {
  const first = name.trim().split(/\s+/)[0] ?? '';
  const initial = first.charAt(0).toUpperCase();
  return { first, initial: initial === '' ? null : initial };
}
