import { SimulationState } from '../type/simulation-state.type';

const MIN_STATE_GAP = 50;

/**
 * Validate a `metadata.states` array per the rules documented on
 * {@link SimulationState}. Returns a list of human-readable errors;
 * an empty list means the input is acceptable.
 *
 * Callers (controller / service / studio client) decide whether to
 * surface the errors as warnings, block save, or block run.
 */
export function validateSimulationStates(
  states: SimulationState[] | undefined | null,
): string[] {
  if (!states || states.length === 0) {
    // Empty / unset is allowed — only `hasStates` prompts require non-empty.
    return [];
  }

  const errors: string[] = [];

  // Ids must be present and unique.
  const idSet = new Set<string>();
  for (const state of states) {
    if (!state?.id) {
      errors.push('Each state must have an id.');
      continue;
    }
    if (idSet.has(state.id)) {
      errors.push(`Duplicate state id: ${state.id}.`);
    }
    idSet.add(state.id);
  }

  // No starting-state flag: the starting state is emergent. With the
  // contiguity + finite-bounds rules below, score 0 always resolves to
  // exactly one state (or clamps to the first), so the state opening the
  // simulation is fully determined by the ranges.

  // Sort by lower bound to validate ordering. All bounds are now finite
  // numbers (strict min/max) — the previous open-ended-at-the-ends design
  // was replaced because authors found "open" Min/Max inputs confusing.
  // Out-of-range scores are clamped at the runtime resolver to the
  // first/last state so total coverage of the score axis is preserved.
  const sorted = [...states].sort((a, b) => {
    const al = a?.scoreLower ?? 0;
    const bl = b?.scoreLower ?? 0;
    return al - bl;
  });

  // Every state's bounds must now be finite numbers.
  for (const state of sorted) {
    if (typeof state?.scoreLower !== 'number') {
      errors.push(
        `State '${state?.name ?? state?.id}' is missing scoreLower (must be a finite number).`,
      );
    }
    if (typeof state?.scoreUpper !== 'number') {
      errors.push(
        `State '${state?.name ?? state?.id}' is missing scoreUpper (must be a finite number).`,
      );
    }
  }
  // Bail before the contiguity / gap checks if any bound is missing —
  // arithmetic on those would emit cascading misleading errors.
  if (errors.length > 0) {
    return errors;
  }

  // Intermediate states need finite bounds; check contiguity + min gap.
  for (let i = 0; i < sorted.length; i++) {
    const state = sorted[i];
    const lower = state?.scoreLower as number;
    const upper = state?.scoreUpper as number;

    // Range sanity within a state: upper - lower >= MIN_STATE_GAP.
    // Equality is allowed (a range of exactly 50 is valid); only strictly-
    // smaller spans are rejected.
    if (upper - lower < MIN_STATE_GAP) {
      errors.push(
        `State '${state.name ?? state.id}' has a score range smaller than ${MIN_STATE_GAP} (lower=${lower}, upper=${upper}).`,
      );
    }

    // Contiguity: next state's lower must equal this state's upper.
    if (i < sorted.length - 1) {
      const next = sorted[i + 1];
      const nextLower = next?.scoreLower as number;
      if (nextLower !== upper) {
        errors.push(
          `State ranges must be contiguous: '${state?.name ?? state?.id}' upper=${upper} does not meet next state '${next?.name ?? next?.id}' lower=${nextLower}.`,
        );
      }
    }
  }

  return errors;
}
