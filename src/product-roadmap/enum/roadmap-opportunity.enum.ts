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
