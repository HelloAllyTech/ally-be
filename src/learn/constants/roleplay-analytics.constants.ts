/**
 * PostHog events for a roleplay session's lifecycle.
 *
 * Names and property keys are the analytics spec's, verbatim — renaming one
 * here without renaming it in the spec silently breaks the dashboards built on
 * it. Fired from `ScenarioSessionService`.
 */
export const ROLEPLAY_ANALYTICS_EVENTS = {
  /** The live call screen loaded and a session row exists — the mic may not be granted yet. */
  SESSION_STARTED: 'roleplay.session_started',
  /** The session reached an end, however it got there; one row in Roleplay Logs. */
  SESSION_ENDED: 'roleplay.session_ended',
} as const;

/**
 * Where the learner came into the roleplay from, derived from which parent
 * pointer the session carries. `streak_widget` is in the spec but is a
 * client-only surface — the server can't see it, so it never fires from here.
 */
export enum RoleplayEntryPoint {
  CASE = 'case',
  PATHWAY = 'pathway',
  TRACK = 'track',
  SIMULATION = 'simulation',
}

/**
 * `completed` means the actor's own end-of-session event landed, i.e. the
 * conversation reached its natural end and was scored. Anything else that
 * closes the room — learner walking away, disconnect, auto-termination — is an
 * abandonment.
 */
export enum RoleplaySessionEndStatus {
  COMPLETED = 'completed',
  ABANDONED = 'abandoned',
}
