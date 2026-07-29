/**
 * A tiny, explicit state machine.
 *
 * BUILD-PROMPT rule 4: no ad-hoc `entity.status = 'X'` anywhere in the
 * codebase. Every transition is declared here, illegal ones throw
 * InvalidTransitionError, and guards make the preconditions executable rather
 * than a comment someone forgets.
 *
 * Guards are PURE: they receive an explicit context object and either return
 * or throw. No DB reads, no clock — callers assemble the context.
 */
import { InvalidTransitionError } from '../errors';

export type Guard<C> = (ctx: C) => void;

export interface Transition<S extends string, C> {
  from: S;
  to: S;
  /** All guards must pass. Each throws its own typed error on failure. */
  guards?: Guard<C>[];
}

export class StateMachine<S extends string, C> {
  private readonly allowed = new Map<string, Guard<C>[]>();

  constructor(
    private readonly entity: string,
    transitions: readonly Transition<S, C>[],
    private readonly terminal: readonly S[] = [],
  ) {
    for (const t of transitions) {
      const key = `${t.from}->${t.to}`;
      if (this.allowed.has(key)) {
        throw new Error(`Duplicate ${entity} transition declared: ${key}`);
      }
      this.allowed.set(key, t.guards ?? []);
    }
  }

  /** Is this transition declared at all? (Ignores guards.) */
  can(from: S, to: S): boolean {
    return this.allowed.has(`${from}->${to}`);
  }

  /**
   * Assert a transition is legal AND its guards pass. Throws
   * InvalidTransitionError for an undeclared move, or the guard's own error
   * (e.g. ForbiddenError) when a precondition fails.
   */
  assert(from: S, to: S, ctx: C): void {
    const guards = this.allowed.get(`${from}->${to}`);
    if (guards === undefined) throw new InvalidTransitionError(this.entity, from, to);
    for (const guard of guards) guard(ctx);
  }

  /** Every state reachable from `from`, guards aside. Useful for UIs and docs. */
  nextStates(from: S): S[] {
    const out: S[] = [];
    for (const key of this.allowed.keys()) {
      const [f, t] = key.split('->') as [S, S];
      if (f === from) out.push(t);
    }
    return out.sort();
  }

  isTerminal(state: S): boolean {
    return this.terminal.includes(state);
  }
}
