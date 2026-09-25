/**
 * PostHog events for the analytics spec's "Admin & Organization" section.
 *
 * Unlike the other analytics constant files, this one does not live under a
 * single `src/<domain>/constants/` — the spec section is one funnel but its
 * events are emitted from three unrelated domains (`user`, then
 * `scenario-session-review`, then `learn`). A shared home next to the PostHog
 * client keeps the section's names in one place instead of splitting four
 * constants across three near-empty files.
 *
 * Names and property keys are the spec's, verbatim — renaming one here without
 * renaming it in the spec silently breaks the dashboards built on it. Every
 * event in this section is marked UNCONFIRMED in the spec (none had been
 * observed when it was written), so the notes below record what the server can
 * actually see for each one; fold them back into the spec.
 */
export const ADMIN_ANALYTICS_EVENTS = {
  /**
   * An admin added a learner to their organization. Fired per created account
   * from both the single-invite and bulk-invite paths.
   */
  LEARNER_INVITED: 'learner.invited',
  /**
   * A completed roleplay session was put up for review. In this codebase the
   * learner submits their own session (there is no queue an admin pushes into),
   * so this fires when the review row is created.
   */
  REVIEW_SUBMITTED: 'review.submitted',
  /**
   * A reviewer finished with a submitted session. The only terminal,
   * reviewer-gated action in the model is marking the review read — that is
   * what clears it from the reviewer's unread count and flips `isReviewed` in
   * the list — so it is what fires here.
   */
  REVIEW_COMPLETED: 'review.completed',
  /** A learner's remaining simulation credits fell past a low-credit mark. */
  CREDIT_THRESHOLD_REACHED: 'credit.threshold_reached',
  /**
   * An organization moved onto a different plan. There is no plan column — a
   * plan is a free-form key on `tenants.metadata`, written through
   * `PUT /v1/tenants/:id/metadata`, so this fires from the one place that
   * rewrites that blob and only when the value actually differs. The spec's
   * name says "upgraded"; a downgrade takes the same event, with the direction
   * readable from `previous_plan` vs `new_plan`.
   */
  PLAN_UPGRADED: 'plan.upgraded',
} as const;

/**
 * Low-credit marks, as a fraction of the learner's credit limit, in descending
 * order.
 *
 * The spec names the event but not the thresholds. These two are the points
 * worth telling anyone about: 20% left is the "top me up soon" warning, and 0
 * is the learner being locked out of further practice. Descending order matters
 * — the crossing check takes the first match, so a single session that blows
 * through both reports the higher mark it crossed, with the true remaining
 * balance on the event's own properties.
 */
export const LOW_CREDIT_THRESHOLD_RATIOS = [0.2, 0] as const;
