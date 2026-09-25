/**
 * PostHog events for Learn — Cases.
 *
 * Fired from `CaseSessionService` at the point the last simulation in a case
 * flips to COMPLETED. Names and property keys are the analytics spec's,
 * verbatim — renaming one here without renaming it in the spec silently breaks
 * the dashboards built on it.
 */
export const CASE_ANALYTICS_EVENTS = {
  /** Every simulation inside a case has been finished at least once. */
  COMPLETED: 'case.completed',
} as const;

/**
 * PostHog events for Learn — Learning Pathway.
 *
 * A pathway is a case: an ordered list of simulations the learner works
 * through. Same source of truth as `CASE_ANALYTICS_EVENTS` above, spec'd
 * separately by analytics, so both fire — `case.completed` is the legacy name
 * kept alive for the dashboards already built on it.
 */
export const PATHWAY_ANALYTICS_EVENTS = {
  /** Learner committed to the pathway — a case session was created. */
  STARTED: 'pathway.started',
  /** One simulation inside the pathway flipped to COMPLETED. */
  STEP_COMPLETED: 'pathway.step_completed',
  /** Every step in the pathway is finished. */
  COMPLETED: 'pathway.completed',
} as const;
