/**
 * Before/after view of an audit row (Admin → Audit log, design 2026-11-15): the JSON of both sides is flattened to
 * dotted paths and compared. Values are shown as compact JSON, cut at 200 characters. Pure; the screen marks each
 * line with a word (added, removed, changed), never colour alone.
 */
export interface AuditDiffLine {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before: string | null;
  after: string | null;
}

const MAX = 200;

function flatten(value: unknown, path: string, out: Map<string, string>): void {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (entries.length > 0) {
      for (const [k, v] of entries) flatten(v, path === '' ? k : `${path}.${k}`, out);
      return;
    }
  }
  const text = value === undefined ? 'null' : JSON.stringify(value);
  out.set(path, text.length > MAX ? `${text.slice(0, MAX)}…` : text);
}

export function diffJson(before: unknown, after: unknown): AuditDiffLine[] {
  const a = new Map<string, string>();
  const b = new Map<string, string>();
  if (before !== null && before !== undefined) flatten(before, '', a);
  if (after !== null && after !== undefined) flatten(after, '', b);
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  const lines: AuditDiffLine[] = [];
  for (const path of paths) {
    const x = a.get(path);
    const y = b.get(path);
    if (x === y) continue;
    if (x === undefined) lines.push({ path, kind: 'added', before: null, after: y ?? null });
    else if (y === undefined) lines.push({ path, kind: 'removed', before: x, after: null });
    else lines.push({ path, kind: 'changed', before: x, after: y });
  }
  return lines;
}
