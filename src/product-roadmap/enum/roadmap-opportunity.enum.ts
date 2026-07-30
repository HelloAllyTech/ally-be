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
 * The opportunity lifecycle. Coins may only be allocated to NEW (enforced in
 * RoadmapAllocationService, not by a trigger, because split/merge must be able to
 * redistribute coins on an opportunity that has already moved on).
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
