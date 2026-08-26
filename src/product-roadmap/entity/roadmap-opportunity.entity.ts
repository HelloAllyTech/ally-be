import {
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import {
  RoadmapEmbeddingStatus,
  RoadmapOpportunitySource,
  RoadmapOpportunityStage,
  RoadmapOpportunityType,
} from '../enum/roadmap-opportunity.enum';

/**
 * The atomic unit of the roadmap: an idea or a bug that people spend coins on.
 *
 * There is deliberately no `priorityScore` column. The score is SUM(coins) over ALL users
 * and ALL periods, computed as a SQL aggregate joined into the list query
 * (RoadmapOpportunityRepository.listOpportunities). A denormalised counter was rejected: the
 * code path most likely to get the arithmetic wrong is split/merge, which moves many
 * allocation rows in one transaction, and a wrong counter cannot be recovered without a
 * rebuild job you would have to write anyway. If this ever becomes a bottleneck (it will not
 * at a few hundred opportunities), the next step is a MATERIALIZED VIEW refreshed
 * CONCURRENTLY — never a counter column, because a matview can be rebuilt from truth.
 */
@Entity('roadmap_opportunities')
@Index('idx_roadmap_opps_stage', ['stage'], { where: '"deletedAt" IS NULL' })
@Index('idx_roadmap_opps_product_goal', ['productGoal'], {
  where: '"deletedAt" IS NULL',
})
@Index('idx_roadmap_opps_owner', ['owner'], { where: '"deletedAt" IS NULL' })
@Index('idx_roadmap_opps_created_by', ['createdBy'], {
  where: '"deletedAt" IS NULL',
})
@Index('idx_roadmap_opps_month_board', ['plannedMonth', 'boardPosition'], {
  where: '"deletedAt" IS NULL',
})
@Index('idx_roadmap_opps_source', ['source'], { where: '"deletedAt" IS NULL' })
export class RoadmapOpportunity extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * The whole opportunity, in one field — there is no separate title. ≤1000 chars and
   * non-blank (CHECK constraint). Callers render the first line as the heading.
   */
  @Column({ type: 'text' })
  description!: string;

  @Column({
    enum: RoadmapOpportunityType,
    default: RoadmapOpportunityType.IDEA,
  })
  type!: RoadmapOpportunityType;

  @Column({
    enum: RoadmapOpportunityStage,
    default: RoadmapOpportunityStage.NEW,
  })
  stage!: RoadmapOpportunityStage;

  /**
   * FK BY NAME to roadmap_product_goals(name), ON UPDATE CASCADE. Not a uuid, because
   * saved-view state stores goal names — see RoadmapSavedViewState.
   */
  @Column({ type: 'text' })
  productGoal!: string;

  /**
   * LEGACY owner name. FK BY NAME to roadmap_opportunity_owners(name),
   * ON UPDATE CASCADE ON DELETE SET NULL.
   *
   * Only authoritative while `ownerUserId` IS NULL — i.e. for rows migrated from the standalone
   * app, whose owners were free-text names rather than accounts. Kept rather than dropped because
   * saved-view state filters on owner NAMES: four of the eight migrated views are defined entirely
   * by `ownerFilter`, and replacing the name with an id would make them silently match nothing.
   */
  @Column({ type: 'text', nullable: true })
  owner?: string | null;

  /**
   * The real owner: an Ally SUPER_ADMIN / SUPER_DUPER_ADMIN user.
   *
   * This is the assignment for anything set after migration 1871000000004. The DISPLAY name is
   * derived from `users.name` via join rather than copied here, so renaming a person in Ally
   * propagates without a sync step — the same property the FK-by-name gave the legacy column.
   * ON DELETE SET NULL: removing an Ally user must not delete roadmap history.
   */
  @Column({ type: 'int', nullable: true })
  ownerUserId?: number | null;

  /** Optional long-form PRD, ≤20000 chars. Plain text / markdown, not HTML. */
  @Column({ type: 'text', nullable: true })
  prd?: string | null;

  /**
   * AI-generated Claude Code implementation prompt, ≤20000 chars. Same treatment as `prd`:
   * plain text/markdown, edited and persisted through the drawer's own Save action rather than
   * a bespoke write path, so it survives a close/reopen instead of being regenerated (and
   * re-billed) every time.
   */
  @Column({ type: 'text', nullable: true })
  claudePrompt?: string | null;

  /**
   * Stamped only when the stage TRANSITIONS into RELEASED, and never re-stamped on a later
   * edit. Split copies it to new parts rather than regenerating. Note a large share of
   * migrated rows have stage=released with releasedAt NULL, because the source trigger also
   * only fired on transition — do not backfill it.
   */
  @Column({ type: 'timestamp', nullable: true })
  releasedAt?: Date | null;

  // ── month board ──────────────────────────────────────────────────────────────

  /**
   * The month somebody PLANNED this into, as 'YYYY-MM' (CHECK-constrained to the same shape as
   * roadmap_allocations."periodKey"). NULL means the Unscheduled lane.
   *
   * This is an intention, not an outcome — which is why it is a separate column from
   * `releasedAt` rather than a reuse of it. Once a row ships, the board stops showing it here
   * and shows it under its release month instead (effectiveMonthOf), so a slipped plan leaves a
   * visible trail: planned for March, shipped in May. Overwriting plannedMonth on release would
   * erase exactly the discrepancy the board exists to surface.
   *
   * Deliberately NOT a date: a month has no day, and storing the 1st invites somebody to render
   * it as a deadline. It is also not an FK to a `roadmap_months` table — a month needs no
   * attributes, and a lane with no cards should cost nothing to exist.
   */
  @Column({ type: 'varchar', length: 7, nullable: true })
  plannedMonth?: string | null;

  /**
   * Manual rank WITHIN a lane, ascending. Not globally meaningful — two cards in different
   * months routinely share a position.
   *
   * DEFAULT 0 is what makes this shippable without a backfill: every existing row starts tied,
   * and the board's ORDER BY falls through to priorityScore DESC, so on day one every lane is
   * already sorted by coins. Dragging progressively replaces that with a human ordering, lane by
   * lane, and nothing has to be migrated for the board to look right.
   *
   * Gaps and duplicates are harmless — the ORDER BY has deterministic tiebreaks — so a reorder
   * rewrites one lane's positions rather than trying to maintain a globally sparse sequence.
   */
  @Column({ type: 'int', default: 0 })
  boardPosition!: number;

  // ── Weaviate reconciliation state (see RoadmapEmbeddingStatus) ────────────────
  @Column({
    enum: RoadmapEmbeddingStatus,
    default: RoadmapEmbeddingStatus.PENDING,
  })
  embeddingStatus!: RoadmapEmbeddingStatus;

  /** Bounded so a permanently-failing row cannot be retried forever by the sweep. */
  @Column({ type: 'int', default: 0 })
  embeddingAttempts!: number;

  @Column({ type: 'timestamp', nullable: true })
  embeddedAt?: Date | null;

  /** Hash of the text that produced the current vector; drives staleness detection. */
  @Column({ type: 'text', nullable: true })
  textHash?: string | null;

  // ── consumer bug reports (added alongside the /bug-reports endpoint) ─────────
  /**
   * Who filed this — 'staff' (the existing admin `/opportunities` path, and every
   * pre-existing row) or 'consumer' (the logged-in-app-user `/bug-reports` path). Admin-side
   * filtering only; never gates the create pipeline, which both paths share.
   */
  @Column({
    enum: RoadmapOpportunitySource,
    default: RoadmapOpportunitySource.STAFF,
  })
  source!: RoadmapOpportunitySource;

  /**
   * The reporting consumer's tenant, informational only — this does NOT make the entity
   * tenant-scoped (there is still no tenant-filtered read path). NULL for every staff-filed
   * row. varchar to match the platform's `tenant_id` convention (see BaseEntity), which is a
   * free-form id rather than a uuid FK — see the `scenario_sessions.tenant_id` join note in
   * DATA_SCHEMA.md.
   */
  @Column({ name: 'tenant_id', type: 'varchar', nullable: true })
  tenantId?: string | null;

  /**
   * Auto-captured client context for a consumer bug report: screen/route, app version,
   * device/OS, client timestamp. Populated entirely from what the client sends — see
   * CreateBugReportDto.context — never inferred server-side beyond the User-Agent
   * fallback in the controller. Admin-visible only, alongside `description`; never runs
   * through crisis-content detection.
   */
  @Column({ type: 'jsonb', nullable: true })
  reporterContext?: Record<string, any> | null;

  // ── audit ────────────────────────────────────────────────────────────────────
  // Integer users.id with NO foreign key, per ally-be convention. A removed Ally user
  // therefore leaves an unresolvable createdBy; response mappers fall back to a placeholder
  // rather than leaking a bare id. Also doubles as the reporter id for a consumer bug report
  // — the same `users` table backs every role, so no separate identity column is needed.
  @Column({ type: 'int' })
  createdBy!: number;

  @Column({ type: 'int' })
  updatedBy!: number;

  /**
   * Soft delete. This is why deleting an opportunity MUST also delete it from Weaviate:
   * Postgres reads filter on deletedAt IS NULL, the vector index has no idea, and a missed
   * delete means duplicate-detection proposes a deleted opportunity forever.
   *
   * Upside of soft delete: release notes keep a denormalised uuid[] of the opportunities
   * they were generated from, and those ids stay resolvable instead of dangling.
   */
  @DeleteDateColumn()
  deletedAt?: Date;
}
