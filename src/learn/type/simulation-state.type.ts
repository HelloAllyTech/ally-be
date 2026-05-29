/**
 * Per-simulation State definition used by `hasStates` main-agent prompts.
 *
 * States are studio-edited and live on `Scenarios.metadata.states`. They
 * are independent of the existing `behaviorInstructions`-based state
 * guidance (`stateInstructions` / `BehaviorStateInstruction`), which
 * continues to work in parallel.
 *
 * Runtime: ai-learn matches the active state by current turn score
 * (`scoreLower <= score < scoreUpper`, with `null` bounds meaning open at
 * that end) and injects the matched state's `guidelines` into
 * `{state_x_guidelines}`. If `ragEnabled` is false on the matched state,
 * retrieval is skipped for that turn.
 *
 * Validation (enforced server-side on save):
 * - Exactly one state has `isStarting: true`.
 * - Ranges are contiguous and non-overlapping.
 * - The first state's `scoreLower` is null (open lower bound).
 * - The last state's `scoreUpper` is null (open upper bound).
 * - When both bounds are finite, `scoreUpper - scoreLower >= 50`.
 */
export interface SimulationState {
  /** Stable id for this state across saves (e.g. UUID or counter-based). */
  id: string;
  /** Human-readable state name displayed in the studio editor. */
  name: string;
  /** Free-text guidance injected into the prompt when this state is active. */
  guidelines: string;
  /** Exactly one state must be marked starting; this picks turn-1 behavior. */
  isStarting: boolean;
  /** Inclusive lower bound on `current_score`; null = open (first state). */
  scoreLower: number | null;
  /** Exclusive upper bound on `current_score`; null = open (last state). */
  scoreUpper: number | null;
  /** When false, the retrieval step is skipped while this state is active. */
  ragEnabled: boolean;
}
