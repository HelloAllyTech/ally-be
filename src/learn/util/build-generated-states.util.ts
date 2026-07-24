import { randomUUID } from 'crypto';
import { SimulationState } from '../type/simulation-state.type';
import { validateSimulationStates } from './validate-simulation-states.util';

/**
 * Contiguous score-band width assigned to each generated state. Wide enough
 * to give a session realistic headroom (~a handful of well-scored turns per
 * band) while comfortably clearing the MIN_STATE_GAP=50 validator floor. The
 * first band opens at 0, so state[0] is the emergent opening state (the range
 * containing the session's starting score) — matching the studio's own
 * seedNextState convention and the ai-learn score resolver.
 */
export const GENERATED_STATE_WIDTH = 100;

/**
 * Upper bound on how many states we accept from the model, mirroring the
 * "never more than 6" ceiling used elsewhere. Extra states are dropped.
 */
export const MAX_GENERATED_STATES = 6;

interface GeneratedStateInput {
  name?: unknown;
  guidelines?: unknown;
  ragEnabled?: unknown;
}

/**
 * Turn the Agent Builder Copilot's raw `states` output into a valid, ready-to-
 * persist `SimulationState[]`.
 *
 * The model supplies only the SEMANTIC content per state — `name`, `guidelines`
 * and `ragEnabled`, ordered from the opening (most guarded) state to the most
 * open. This helper owns the numeric machinery the model must not be trusted
 * with: it assigns stable ids and lays the states out on contiguous,
 * non-overlapping score bands (`[0,W), [W,2W), …`) so the result always passes
 * `validateSimulationStates`. States missing a name or guidelines are dropped;
 * anything left over past MAX_GENERATED_STATES is trimmed.
 *
 * Returns `[]` (rather than a partial/invalid set) when there is nothing usable
 * or — defensively — if the assembled set somehow fails validation, so the
 * studio paints nothing instead of garbage.
 */
export function buildGeneratedStates(items: unknown): SimulationState[] {
  const arr: unknown[] = Array.isArray(items) ? items : [];

  const cleaned = arr
    .map((raw) => raw as GeneratedStateInput)
    .map((raw) => ({
      name: typeof raw?.name === 'string' ? raw.name.trim() : '',
      guidelines:
        typeof raw?.guidelines === 'string' ? raw.guidelines.trim() : '',
      // Default RAG on unless the model explicitly turned it off for a state.
      ragEnabled: typeof raw?.ragEnabled === 'boolean' ? raw.ragEnabled : true,
    }))
    .filter((s) => s.name.length > 0 && s.guidelines.length > 0)
    .slice(0, MAX_GENERATED_STATES);

  const states: SimulationState[] = cleaned.map((s, index) => ({
    id: randomUUID(),
    name: s.name,
    guidelines: s.guidelines,
    scoreLower: index * GENERATED_STATE_WIDTH,
    scoreUpper: (index + 1) * GENERATED_STATE_WIDTH,
    ragEnabled: s.ragEnabled,
  }));

  if (states.length === 0) return [];

  // Belt-and-braces: the layout above is contiguous by construction, but keep
  // the same gate the save path uses so a future change here can't ship an
  // invalid set into the form.
  return validateSimulationStates(states).length === 0 ? states : [];
}
