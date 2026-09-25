/**
 * Whose notebook an entry belongs to.
 *
 * One table for every agent's memory, scoped by this column, rather than a
 * table per agent — the ADR in docs/bug-hunter-memory-adr.md. Builder's
 * `builder_lessons` rows are the next to move here (OPP-0714); until then
 * BUILDER is reserved and unused, and Bug Hunter is the only writer.
 *
 * `character varying` with a CHECK constraint, per repo convention. Adding a
 * value means extending `CHK_agent_memories_agent` AND the row in
 * `check-constraints-cover-enums.spec.ts`.
 */
export enum AgentMemoryAgent {
  BUG_HUNTER = 'bug_hunter',
  BUILDER = 'builder',
}

/**
 * Where an entry sits in the curated set. Mirrors `BuilderLessonStatus` on
 * purpose so Builder's curator can run over this table unchanged.
 *
 * In this prototype Bug Hunter writes entries straight to ACTIVE: the curator
 * that folds candidates in (AGREE/EDIT/ADD/REMOVE) is OPP-0714. The column and
 * the CANDIDATE value exist now so that landing the curator is a behaviour
 * change, not a migration.
 */
export enum AgentMemoryStatus {
  CANDIDATE = 'candidate',
  ACTIVE = 'active',
  MERGED = 'merged',
  RETIRED = 'retired',
}

/**
 * Reconciliation state for the derived Weaviate index — the same four values
 * as `RoadmapEmbeddingStatus`, kept as a separate enum so the two tables can
 * diverge without a shared enum quietly coupling them.
 */
export enum AgentMemoryEmbeddingStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}
