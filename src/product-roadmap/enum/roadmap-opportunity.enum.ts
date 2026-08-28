/**
 * Value sets for roadmap_opportunities. Stored as `character varying` per ally-be
 * convention (not Postgres enums), with CHECK constraints in migration 1871000000000
 * recovering the guarantee that a typo can never land in the column.
 *
 * The string values are the WIRE and STORAGE format and are shared verbatim with the
 * standalone app's data — do not rename them without a data migration.
 */
export enum RoadmapOpportunityType {
  IDEA = 'idea',
  BUG = 'bug',
}

/**
 * The opportunity lifecycle. Votes may only be cast on NEW (enforced in
 * RoadmapAllocationService, not by a trigger, because split/merge must be able to
 * redistribute votes on an opportunity that has already moved on).
 *
 * `releasedAt` is stamped only on the TRANSITION into RELEASED, never re-stamped, and is
 * copied rather than regenerated when a released opportunity is split.
 */
export enum RoadmapOpportunityStage {
  NEW = 'new',
  PRIORITISED = 'prioritised',
  UNDER_DEVELOPMENT = 'under_development',
  RELEASED = 'released',
  ARCHIVED = 'archived',
}

/**
 * Rough size of the work, on the shirt-size scale teams already use in estimation.
 *
 * A JUDGEMENT, not a measurement: the point of shirt sizes is that they are quick and coarse, so
 * they get filled in. Storing hours or points instead invites false precision on something nobody
 * has broken down yet — and the roadmap's job is deciding what is next, which needs "is this a
 * week or a quarter", not "is this 13 points or 21".
 *
 * NULLABLE everywhere. Every existing row has no effort and no backfill can invent one, so
 * "unsized" is a real and permanent state rather than a gap waiting to be filled. Nothing gates
 * on it.
 *
 * Stored as `character varying` per ally-be convention (not a Postgres enum), with a CHECK
 * constraint in the migration recovering the guarantee that a typo cannot land in the column.
 * The string values are the WIRE and STORAGE format.
 */
export enum RoadmapOpportunityEffort {
  S = 's',
  M = 'm',
  L = 'l',
  XL = 'xl',
  XXL = 'xxl',
}

/**
 * Reconciliation state for the derived Weaviate index (ally-ai's `RoadmapOpportunity`
 * collection). Postgres is the system of record; the vector index can drift because a
 * network call can fail, so drift must be detectable and healable.
 *
 *   PENDING — never indexed, or the text changed since it was.
 *   SUCCESS — the vector in Weaviate matches `textHash`.
 *   FAILED  — indexing was attempted `embeddingAttempts` times and threw.
 *   SKIPPED — deliberately not indexed (e.g. soft-deleted, so it must NOT be a
 *             duplicate-check candidate).
 */
export enum RoadmapEmbeddingStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

/**
 * Who filed the opportunity, for admin-side filtering only — this has no bearing on
 * permissions or on the create pipeline (both paths run through
 * RoadmapOpportunityService.create). Default is STAFF so every pre-existing row and the
 * staff-facing `/opportunities` endpoint need no change.
 */
export enum RoadmapOpportunitySource {
  STAFF = 'staff',
  CONSUMER = 'consumer',
}

/**
 * How the board groups its lanes.
 *
 * MONTH is the default and the original board — lanes are calendar months and a card's lane is
 * derived (`effectiveMonthOf`). The other three group by a plain column, which is what makes
 * them draggable: dropping a card in a lane writes that column, exactly as editing the field in
 * the drawer does.
 *
 * That difference is the whole reason the released/archived pinning rule has no equivalent here.
 * A shipped card is pinned in MONTH because its lane comes from `releasedAt`, a stamped fact
 * with no writable counterpart — asking to drag it out is asking to restate when it shipped.
 * Stage, goal and owner are all editable at any stage today, so a board that refused what the
 * drawer allows would just be a worse way to do the same edit.
 */
export enum RoadmapBoardGroupBy {
  MONTH = 'month',
  STAGE = 'stage',
  PRODUCT_GOAL = 'productGoal',
  OWNER = 'owner',
}
