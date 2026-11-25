/**
 * Whether the shop suggestion list is open (spec 02). The list is closed for the exact words it was closed at
 * (Esc, a pick, Enter, the form submit, blur); typing different words opens it again. Tying "closed" to the words,
 * not to a flag that every change of words clears, is what keeps a picked suggestion closed after the box is filled
 * with its label (bug 2026-11-25: the list stayed open over the new results).
 */
export function isSuggestOpen(input: {
  typed: string;
  long: boolean;
  itemCount: number;
  loadedFor: string;
  closedAt: string | null;
}): boolean {
  const { typed, long, itemCount, loadedFor, closedAt } = input;
  return long && closedAt !== typed && itemCount > 0 && loadedFor === typed;
}
