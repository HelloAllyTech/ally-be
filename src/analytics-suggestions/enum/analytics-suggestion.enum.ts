/**
 * Where a suggestion sits in the review queue.
 *
 * Stored as `character varying` with a CHECK constraint, per repo convention —
 * not a Postgres enum, which cannot gain a value without a table rewrite.
 *
 * The three states are terminal in one direction only: PENDING may become
 * ACCEPTED or REJECTED, and neither of those returns. That is deliberate — a
 * decided suggestion is a recorded decision, and the two ways to revisit one are
 * to edit the roadmap opportunity it produced or to let the next generation
 * re-propose it (which a rejection with a reason explicitly discourages).
 */
export enum AnalyticsSuggestionStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
}

/**
 * Which pipeline drafted the suggestion.
 *
 * `ANALYTICS_WINDOW` is the original Generate run over a platform-analytics
 * window (admin Analytics → Suggestions). `UX_SIGNAL` is the UX Signals scan
 * over PostHog telemetry (src/ux-signals). Both land in the same queue and share
 * one accept/reject flow — the distinction exists so a reviewer can tell what
 * kind of evidence backs a card, not because the two are handled differently.
 */
export enum AnalyticsSuggestionSource {
  ANALYTICS_WINDOW = 'analytics_window',
  UX_SIGNAL = 'ux_signal',
}

/** Statuses a client may filter the queue by, plus the "show everything" option. */
export const ANALYTICS_SUGGESTION_STATUS_FILTERS = [
  ...Object.values(AnalyticsSuggestionStatus),
  'all',
] as const;

export type AnalyticsSuggestionStatusFilter =
  (typeof ANALYTICS_SUGGESTION_STATUS_FILTERS)[number];
