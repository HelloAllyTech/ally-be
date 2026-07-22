/**
 * What the copilot is doing in a session.
 *
 * BUILDING — the interview + inference flow that authors the spec from scratch
 *   (ask_trainer questions, behaviour review, incremental update_spec patches).
 * ITERATING — post-build refinement: the trainer live-tests the roleplay and
 *   gives feedback in natural language; the copilot reasons about which part(s)
 *   of the spec drive the behaviour they want changed and patches those,
 *   grounded in the runtime telemetry of their test sessions.
 *
 * A session starts in BUILDING and the trainer flips it to ITERATING from the
 * studio once the spec is built (see CopilotSessionService.setMode). The
 * orchestrator reads this to choose the system prompt and tool belt.
 */
export enum CopilotSessionMode {
  BUILDING = 'BUILDING',
  ITERATING = 'ITERATING',
}
