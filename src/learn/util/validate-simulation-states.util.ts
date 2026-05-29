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

  // Exactly one starting state.
  const startingStates = states.filter((s) => s?.isStarting);
  if (startingStates.length === 0) {
    errors.push('Exactly one state must be marked as the starting state.');
  } else if (startingStates.length > 1) {
    errors.push(
      `Only one state may be the starting state; found ${startingStates.length}.`,
    );
  }

  // Sort by lower bound (treating null as -Infinity) to validate ordering.
  const sorted = [...states].sort((a, b) => {
    const al = a?.scoreLower ?? Number.NEGATIVE_INFINITY;
    const bl = b?.scoreLower ?? Number.NEGATIVE_INFINITY;
    return al - bl;
  });

  // First state must have open lower bound; last must have open upper.
  if (sorted[0]?.scoreLower !== null && sorted[0]?.scoreLower !== undefined) {
    errors.push(
      `First state '${sorted[0]?.name ?? sorted[0]?.id}' must have an open lower bound (scoreLower: null).`,
    );
  }
  const last = sorted[sorted.length - 1];
  if (last?.scoreUpper !== null && last?.scoreUpper !== undefined) {
    errors.push(
      `Last state '${last?.name ?? last?.id}' must have an open upper bound (scoreUpper: null).`,
    );
  }

  // Intermediate states need finite bounds; check contiguity + min gap.
  for (let i = 0; i < sorted.length; i++) {
    const state = sorted[i];
    const lower = state?.scoreLower;
    const upper = state?.scoreUpper;

    // Range sanity within a state: upper - lower >= MIN_STATE_GAP when
    // both bounds are finite. Equality is allowed (a range of exactly 50
    // is valid); only strictly-smaller spans are rejected.
    if (
      typeof lower === 'number' &&
      typeof upper === 'number' &&
      upper - lower < MIN_STATE_GAP
    ) {
      errors.push(
        `State '${state.name ?? state.id}' has a score range smaller than ${MIN_STATE_GAP} (lower=${lower}, upper=${upper}).`,
      );
    }

    // Contiguity: next state's lower must equal this state's upper.
    if (i < sorted.length - 1) {
      const next = sorted[i + 1];
      const nextLower = next?.scoreLower;
      if (upper === null || upper === undefined) {
        errors.push(
          `Only the last state may have an open upper bound; '${state?.name ?? state?.id}' has scoreUpper: null but is not last.`,
        );
      } else if (nextLower === null || nextLower === undefined) {
        errors.push(
          `Only the first state may have an open lower bound; '${next?.name ?? next?.id}' has scoreLower: null but is not first.`,
        );
      } else if (nextLower !== upper) {
        errors.push(
          `State ranges must be contiguous: '${state?.name ?? state?.id}' upper=${upper} does not meet next state '${next?.name ?? next?.id}' lower=${nextLower}.`,
        );
      }
    }
  }

  return errors;
}
