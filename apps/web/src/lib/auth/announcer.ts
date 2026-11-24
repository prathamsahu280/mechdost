export type AnnounceKind = 'polite' | 'assertive';

/**
 * Screen-reader messages for two always-mounted regions. A message is emptied first and set again after a tick so
 * a repeat is read again; `clear` empties a region and cancels a message still waiting, so a stale alert is never
 * left behind after the form moves on (login, 2026-11-24).
 */
export function createAnnouncer(
  setters: Record<AnnounceKind, (value: string) => void>,
  delayMs = 100,
): {
  announce: (message: string, kind?: AnnounceKind) => void;
  clear: (kind: AnnounceKind) => void;
} {
  const timers: Partial<Record<AnnounceKind, ReturnType<typeof setTimeout>>> = {};
  const clear = (kind: AnnounceKind) => {
    clearTimeout(timers[kind]);
    timers[kind] = undefined;
    setters[kind]('');
  };
  const announce = (message: string, kind: AnnounceKind = 'polite') => {
    clear(kind);
    timers[kind] = setTimeout(() => {
      timers[kind] = undefined;
      setters[kind](message);
    }, delayMs);
  };
  return { announce, clear };
}
