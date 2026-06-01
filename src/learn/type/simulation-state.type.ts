/**
 * Per-simulation State definition for variants whose prompt body
 * references `{state_x_guidelines}`.
 *
 * States are studio-edited and live on `Scenarios.metadata.states`. They
 * are independent of the existing `behaviorInstructions`-based state
 * guidance (`stateInstructions` / `BehaviorStateInstruction`), which
 * continues to work in parallel.
 *
 * Runtime: ai-learn matches the active state by current turn score
 * (`scoreLower <= score < scoreUpper`). Scores below the first state's
 * lower or at/above the last state's upper clamp to the nearest state
 * (see `_resolve_simulation_state_by_score` in ally-ai-learn). The
 * matched state's `guidelines` are injected into `{state_x_guidelines}`,
 * and if `ragEnabled` is false on that state the retrieval step is
 * skipped — `{retrieved_context}` substitutes empty for the turn.
 *
 * Validation (enforced server-side on save):
 * - Exactly one state has `isStarting: true`.
 * - Every state's `scoreLower` / `scoreUpper` are finite numbers
 *   (strict-bounds — `null` is no longer accepted; clamping handles
 *   out-of-range scores at runtime).
 * - Ranges are contiguous and non-overlapping.
 * - For every state, `scoreUpper - scoreLower >= 50`.
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
  /**
   * Inclusive lower bound on `current_score`. Required (finite number).
   * `null` is accepted in the type for in-flight editor state (a blank
   * input briefly reads as null before the user types a digit) but the
   * validator rejects it on save.
   */
  scoreLower: number | null;
  /**
   * Exclusive upper bound on `current_score`. Required (finite number).
   * Same in-flight null caveat as `scoreLower`.
   */
  scoreUpper: number | null;
  /**
   * When false, the retrieval step is skipped while this state is
   * active and `{retrieved_context}` substitutes empty. Surface this
   * to admins so they can build grounded-only or intentionally minimal
   * phases without touching the runtime.
   */
  ragEnabled: boolean;
}
