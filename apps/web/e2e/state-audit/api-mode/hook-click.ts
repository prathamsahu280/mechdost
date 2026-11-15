/**
 * Bounded clicks for the page set-up hooks. A hook click that waits for something the state does not render
 * (a history entry when nothing is published, a form when the list failed to load, a tab when there are no
 * shops) waits for the whole 90 s test timeout. The hook notes it and moves on; the checks then run on what is there.
 */
export const BOUNDED_MS = 3_000;

interface Clickable {
  count(): Promise<number>;
  click(options?: { timeout?: number }): Promise<unknown>;
  first(): Clickable;
}

export async function clickIfPresent(target: Clickable, notes: string[], note: string): Promise<boolean> {
  const one = target.first();
  if ((await one.count()) === 0) {
    notes.push(note);
    return false;
  }
  try {
    await one.click({ timeout: BOUNDED_MS });
    return true;
  } catch {
    notes.push(note);
    return false;
  }
}
