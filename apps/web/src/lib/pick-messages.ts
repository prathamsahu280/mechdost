/** Pure helper of `ClientMessages` (kept apart so unit tests need no next-intl server code). */
/** Copies the named namespaces (or sub-trees) of `messages` into one object of the same shape. */
export function pickMessages(
  messages: Record<string, unknown>,
  paths: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const path of paths) {
    const parts = path.split('.');
    let from: unknown = messages;
    for (const part of parts)
      from = typeof from === 'object' && from !== null ? (from as Record<string, unknown>)[part] : undefined;
    if (from === undefined) continue;
    let into = out;
    for (const part of parts.slice(0, -1)) {
      const next = into[part];
      into[part] = typeof next === 'object' && next !== null ? next : {};
      into = into[part] as Record<string, unknown>;
    }
    into[parts[parts.length - 1] ?? path] = from;
  }
  return out;
}
