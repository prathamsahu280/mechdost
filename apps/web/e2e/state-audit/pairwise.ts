/**
 * Deterministic all-pairs (pairwise) and full-cross generators for the UI state audit (2026-11-14).
 *
 * No dependency and no randomness: the same parameters always give the same rows in the same order, so the
 * checklist ids derived from them (`docs/qa/ui-state-checklist.md`) stay stable until the model changes.
 *
 * Algorithm: greedy, in the spirit of AETG/IPO. While some value pair is uncovered, start a row from the first
 * uncovered pair (parameter order, then value order), then give every other parameter the value that covers the
 * most still-uncovered pairs with the values already in the row (ties: the value used least so far, then list
 * order). A `valid` predicate sees partial rows and rejects impossible combinations; pairs that no valid row can
 * hold are dropped. `extendPairs` grows fixed rows (a full cross) with extra parameters the same way.
 *
 * Pure module with explicit `.ts` imports only, so Node can run it directly (`scripts/state-audit-checklist.mjs`).
 */

export type Value = string | number;
export type Row = Readonly<Record<string, Value>>;

export interface Param {
  readonly name: string;
  readonly values: readonly Value[];
}

/** Returns false only when the (possibly partial) row can never be valid. */
export type Valid = (row: Row) => boolean;

const always: Valid = () => true;

interface PairKey {
  a: number;
  av: number;
  b: number;
  bv: number;
}

const key = (p: PairKey) => `${String(p.a)}:${String(p.av)}|${String(p.b)}:${String(p.bv)}`;

function rowOf(params: readonly Param[], idx: readonly (number | undefined)[]): Record<string, Value> {
  const row: Record<string, Value> = {};
  idx.forEach((v, i) => {
    const p = params[i];
    if (v !== undefined && p) {
      const value = p.values[v];
      if (value !== undefined) row[p.name] = value;
    }
  });
  return row;
}

function checkParams(params: readonly Param[]): void {
  const names = new Set<string>();
  for (const p of params) {
    if (p.values.length === 0) throw new Error(`parameter ${p.name} has no values`);
    if (names.has(p.name)) throw new Error(`parameter ${p.name} is listed twice`);
    if (new Set(p.values).size !== p.values.length) throw new Error(`parameter ${p.name} repeats a value`);
    names.add(p.name);
  }
}

/** Every value pair of every two parameters that some partial row allows. */
function allPairKeys(params: readonly Param[], valid: Valid): Map<string, PairKey> {
  const pairs = new Map<string, PairKey>();
  for (let a = 0; a < params.length; a++)
    for (let b = a + 1; b < params.length; b++) {
      const pa = params[a];
      const pb = params[b];
      if (!pa || !pb) continue;
      for (let av = 0; av < pa.values.length; av++)
        for (let bv = 0; bv < pb.values.length; bv++) {
          const idx: (number | undefined)[] = [];
          idx[a] = av;
          idx[b] = bv;
          if (!valid(rowOf(params, idx))) continue;
          const p = { a, av, b, bv };
          pairs.set(key(p), p);
        }
    }
  return pairs;
}

function coveredBy(idx: readonly (number | undefined)[]): string[] {
  const keys: string[] = [];
  for (let a = 0; a < idx.length; a++)
    for (let b = a + 1; b < idx.length; b++) {
      const av = idx[a];
      const bv = idx[b];
      if (av !== undefined && bv !== undefined) keys.push(key({ a, av, b, bv }));
    }
  return keys;
}

/** Fill the unset parameters of `idx` greedily (in parameter order). Returns false when no valid value exists. */
function fill(
  params: readonly Param[],
  idx: (number | undefined)[],
  uncovered: ReadonlyMap<string, PairKey>,
  usage: number[][],
  valid: Valid,
): boolean {
  for (let i = 0; i < params.length; i++) {
    if (idx[i] !== undefined) continue;
    const p = params[i];
    if (!p) return false;
    let best: number | undefined;
    let bestGain = -1;
    let bestUse = Number.POSITIVE_INFINITY;
    for (let v = 0; v < p.values.length; v++) {
      idx[i] = v;
      if (!valid(rowOf(params, idx))) continue;
      let gain = 0;
      for (let j = 0; j < params.length; j++) {
        const jv = idx[j];
        if (j === i || jv === undefined) continue;
        const k = j < i ? key({ a: j, av: jv, b: i, bv: v }) : key({ a: i, av: v, b: j, bv: jv });
        if (uncovered.has(k)) gain++;
      }
      const use = usage[i]?.[v] ?? 0;
      if (gain > bestGain || (gain === bestGain && use < bestUse)) {
        best = v;
        bestGain = gain;
        bestUse = use;
      }
    }
    idx[i] = best;
    if (best === undefined) return false;
  }
  return true;
}

/**
 * All-pairs rows: every value pair of every two parameters appears in at least one row (unless `valid` forbids
 * it). `seeds` are rows that must be included first (e.g. the state a user reported).
 */
export function pairwise(
  params: readonly Param[],
  opts: { valid?: Valid; seeds?: readonly Row[] } = {},
): Row[] {
  checkParams(params);
  const valid = opts.valid ?? always;
  if (params.length === 1) {
    const only = params[0];
    return only ? only.values.filter((v) => valid({ [only.name]: v })).map((v) => ({ [only.name]: v })) : [];
  }
  const uncovered = allPairKeys(params, valid);
  const usage = params.map((p) => p.values.map(() => 0));
  const rows: Row[] = [];
  const take = (idx: readonly (number | undefined)[]) => {
    for (const k of coveredBy(idx)) uncovered.delete(k);
    idx.forEach((v, i) => {
      const u = usage[i];
      if (v !== undefined && u) u[v] = (u[v] ?? 0) + 1;
    });
    rows.push(rowOf(params, idx));
  };
  for (const seed of opts.seeds ?? []) {
    const idx = params.map((p) => {
      const at = p.values.indexOf(seed[p.name] ?? Number.NaN);
      return at >= 0 ? at : undefined;
    });
    if (fill(params, idx, uncovered, usage, valid)) take(idx);
  }
  while (uncovered.size > 0) {
    const first = uncovered.values().next().value;
    if (!first) break;
    const idx: (number | undefined)[] = params.map(() => undefined);
    idx[first.a] = first.av;
    idx[first.b] = first.bv;
    if (fill(params, idx, uncovered, usage, valid)) take(idx);
    else uncovered.delete(key(first));
  }
  return rows;
}

/** Every combination (cartesian product) of the parameters, minus the rows `valid` rejects. */
export function cross(params: readonly Param[], valid: Valid = always): Row[] {
  checkParams(params);
  let rows: Record<string, Value>[] = [{}];
  for (const p of params) rows = rows.flatMap((r) => p.values.map((v) => ({ ...r, [p.name]: v })));
  return rows.filter((r) => valid(r));
}

/**
 * Grow fixed rows (usually a full cross of the high-risk parameters) with `extra` parameters so every pair between
 * an extra parameter and any other parameter value present is covered; rows are added only when the fixed rows
 * cannot hold a pair. The fixed rows keep their order and come first.
 */
export function extendPairs(fixed: readonly Row[], extra: readonly Param[], valid: Valid = always): Row[] {
  if (extra.length === 0) return [...fixed];
  const base: Param[] = [];
  for (const row of fixed)
    for (const [name, value] of Object.entries(row)) {
      let p = base.find((x) => x.name === name);
      if (!p) {
        p = { name, values: [] };
        base.push(p);
      }
      if (!p.values.includes(value)) (p.values as Value[]).push(value);
    }
  const params = [...base, ...extra];
  checkParams(params);
  // Only pairs that involve an extra parameter: pairs among the fixed parameters are what the cross decided.
  const uncovered = new Map(
    [...allPairKeys(params, valid)].filter(([, p]) => p.b >= base.length || p.a >= base.length),
  );
  const usage = params.map((p) => p.values.map(() => 0));
  const rows: Row[] = [];
  const take = (idx: readonly (number | undefined)[]) => {
    for (const k of coveredBy(idx)) uncovered.delete(k);
    idx.forEach((v, i) => {
      const u = usage[i];
      if (v !== undefined && u) u[v] = (u[v] ?? 0) + 1;
    });
    rows.push(rowOf(params, idx));
  };
  for (const row of fixed) {
    const idx = params.map((p, i) =>
      i < base.length ? p.values.indexOf(row[p.name] ?? Number.NaN) : undefined,
    );
    const start = idx.map((v, i) => (i < base.length && v === -1 ? undefined : v));
    if (!fill(params, start, uncovered, usage, valid)) throw new Error('a fixed row has no valid extension');
    take(start);
  }
  while (uncovered.size > 0) {
    const first = uncovered.values().next().value;
    if (!first) break;
    const idx: (number | undefined)[] = params.map(() => undefined);
    idx[first.a] = first.av;
    idx[first.b] = first.bv;
    if (fill(params, idx, uncovered, usage, valid)) take(idx);
    else uncovered.delete(key(first));
  }
  return rows;
}

/** Value pairs of `params` that `rows` leave uncovered (used by the unit test and as a self-check). */
export function missingPairs(
  params: readonly Param[],
  rows: readonly Row[],
  valid: Valid = always,
): string[] {
  const missing: string[] = [];
  for (let a = 0; a < params.length; a++)
    for (let b = a + 1; b < params.length; b++) {
      const pa = params[a];
      const pb = params[b];
      if (!pa || !pb) continue;
      for (const av of pa.values)
        for (const bv of pb.values) {
          if (!valid({ [pa.name]: av, [pb.name]: bv })) continue;
          if (!rows.some((r) => r[pa.name] === av && r[pb.name] === bv))
            missing.push(`${pa.name}=${String(av)} × ${pb.name}=${String(bv)}`);
        }
    }
  return missing;
}
