/**
 * Minimal, typed finite-state machines. Every status change in MechDost goes through one of these and is then
 * applied in the database as a conditional UPDATE (`WHERE status = $from AND version = $v`) — see
 * docs/specs/14-data-integrity.md. The machine decides *whether* a move is legal and *who* may make it.
 */

/** `member` = an Ustaad Network member acting in the network (spec 23 § 7). */
export type Actor = 'customer' | 'shop' | 'workshop' | 'admin' | 'system' | 'member';

export interface TransitionDef<S extends string> {
  from: S;
  to: S;
  by: readonly Actor[];
}

export class IllegalTransitionError extends Error {
  readonly code = 'ILLEGAL_TRANSITION';
  constructor(machine: string, from: string, to: string) {
    super(`${machine}: illegal transition ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export class ActorNotAllowedError extends Error {
  readonly code = 'ACTOR_NOT_ALLOWED';
  constructor(machine: string, from: string, to: string, actor: Actor) {
    super(`${machine}: actor "${actor}" is not allowed to move ${from} → ${to}`);
    this.name = 'ActorNotAllowedError';
  }
}

export interface Machine<S extends string> {
  readonly name: string;
  readonly states: readonly S[];
  readonly terminal: readonly S[];
  can(from: S, to: S): boolean;
  canActor(from: S, to: S, actor: Actor): boolean;
  /** Throws IllegalTransitionError / ActorNotAllowedError. */
  assert(from: S, to: S, actor: Actor): void;
  isTerminal(state: S): boolean;
  next(from: S): S[];
}

export function defineMachine<const S extends string>(
  name: string,
  states: readonly S[],
  terminal: readonly S[],
  transitions: readonly TransitionDef<S>[],
): Machine<S> {
  const table = new Map<string, ReadonlySet<Actor>>();
  for (const t of transitions) {
    if (terminal.includes(t.from))
      throw new Error(`${name}: terminal state ${t.from} cannot have outgoing transitions`);
    table.set(`${t.from}>${t.to}`, new Set(t.by));
  }
  return {
    name,
    states,
    terminal,
    can: (from, to) => table.has(`${from}>${to}`),
    canActor: (from, to, actor) => table.get(`${from}>${to}`)?.has(actor) ?? false,
    assert(from, to, actor) {
      const actors = table.get(`${from}>${to}`);
      if (!actors) throw new IllegalTransitionError(name, from, to);
      if (!actors.has(actor)) throw new ActorNotAllowedError(name, from, to, actor);
    },
    isTerminal: (state) => terminal.includes(state),
    next: (from) => transitions.filter((t) => t.from === from).map((t) => t.to),
  };
}
