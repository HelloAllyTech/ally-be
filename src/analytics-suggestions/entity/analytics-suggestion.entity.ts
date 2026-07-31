import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { RoadmapOpportunityType } from 'src/product-roadmap/enum/roadmap-opportunity.enum';

import { AnalyticsSuggestionStatus } from '../enum/analytics-suggestion.enum';

/**
 * One LLM-drafted product suggestion awaiting a super-duper-admin's decision.
 *
 * The CHECK constraints, the FK to roadmap_opportunities and the indexes live in
 * migration 1874000000000 only — TypeORM cannot express them and
 * `migration:generate` would propose dropping them. Never generate migrations
 * against this table.
 *
 * No soft delete: the queue's whole value is that a decision is permanent and
 * feeds the next run, so there is nothing a delete would mean that
 * REJECTED does not already say. Rows are never removed.
 */
@Entity('analytics_suggestions')
export class AnalyticsSuggestion extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * The Generate run this came from. Not a FK — there is no batch table, because
   * a batch has no state of its own beyond the rows it produced, and every fact
   * a reader needs about the run (window, model) is denormalised onto each row
   * so a suggestion stays self-describing when read on its own.
   */
  @Column({ name: 'batch_id', type: 'uuid' })
  batchId!: string;

  /** Short headline for the card. Truncated to 200 chars before storing. */
  @Column({ type: 'text' })
  title!: string;

  /**
   * The suggestion itself: problem, who it affects, and the evidence. Capped at
   * the roadmap's own description limit (1000) because this is what gets
   * pre-filled into the file-an-opportunity form on accept — a body that could
   * not be filed would be a dead end.
   */
  @Column({ type: 'text' })
  body!: string;

  /** Why it is worth doing now, tied to the window's data. May be empty. */
  @Column({ type: 'text', default: '' })
  rationale!: string;

  /** The specific metric observations the model cited, as plain strings. */
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  evidence!: string[];

  /**
   * The product goal the model classified this into, or NULL when its answer was
   * not a live goal.
   *
   * NULL is a normal outcome, not an error: see RoadmapAiService.classifyGoal for
   * why an unvalidated model answer is never stored as taxonomy. Re-validated at
   * accept time, since a goal can be renamed or retired while a suggestion waits.
   */
  @Column({ name: 'suggested_goal', type: 'text', nullable: true })
  suggestedGoal?: string | null;

  @Column({
    name: 'suggested_type',
    enum: RoadmapOpportunityType,
    default: RoadmapOpportunityType.IDEA,
  })
  suggestedType!: RoadmapOpportunityType;

  @Column({
    enum: AnalyticsSuggestionStatus,
    default: AnalyticsSuggestionStatus.PENDING,
  })
  status!: AnalyticsSuggestionStatus;

  /**
   * Optional free text captured when rejecting, and fed into the next
   * generation's prompt as a standing decision. A rejection without a reason is
   * allowed but comes back: the model is only told "not this" rather than why.
   */
  @Column({ name: 'rejected_reason', type: 'text', nullable: true })
  rejectedReason?: string | null;

  /**
   * The roadmap opportunity this became. Set on accept; ON DELETE SET NULL, so
   * deleting the opportunity leaves the suggestion accepted with no link rather
   * than erasing the record that it was proposed and agreed to.
   */
  @Column({ name: 'opportunity_id', type: 'uuid', nullable: true })
  opportunityId?: string | null;

  // ── provenance of the claim ──────────────────────────────────────────────────
  /** The preset the reader chose, or NULL for an explicit from/to window. */
  @Column({ name: 'window_range', type: 'varchar', length: 10, nullable: true })
  windowRange?: string | null;

  @Column({ name: 'window_from', type: 'date' })
  windowFrom!: string;

  /** Inclusive, as `describeWindow` reports it and as a reader reads a range. */
  @Column({ name: 'window_to', type: 'date' })
  windowTo!: string;

  /** Human-readable window, e.g. "Last 30 days" or "2026-01-01 → 2026-03-31". */
  @Column({ name: 'window_label', type: 'text' })
  windowLabel!: string;

  /** The model that drafted it. Two runs weeks apart are not the same evidence. */
  @Column({ type: 'text' })
  model!: string;

  // ── audit ────────────────────────────────────────────────────────────────────
  // Integer users.id with NO foreign key, per ally-be convention.
  @Column({ name: 'created_by', type: 'int' })
  createdBy!: number;

  @Column({ name: 'updated_by', type: 'int' })
  updatedBy!: number;
}
