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

/** Statuses a client may filter the queue by, plus the "show everything" option. */
export const ANALYTICS_SUGGESTION_STATUS_FILTERS = [
  ...Object.values(AnalyticsSuggestionStatus),
  'all',
] as const;

export type AnalyticsSuggestionStatusFilter =
  (typeof ANALYTICS_SUGGESTION_STATUS_FILTERS)[number];
