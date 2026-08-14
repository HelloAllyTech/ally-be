import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { BugHuntEventStage } from '../enum/bug-hunt-event.enum';

/**
 * Append-only transcript of everything a bug-hunt run did — the audit trail
 * the admin tab's timeline renders. Modeled on CopilotMessage
 * (roleplay-studio): no soft delete, no update path, one row per step.
 *
 * Deliberately NOT the platform `AuditLog` (`src/audit`): that table is a
 * HIPAA compliance log with its own event taxonomy and retention rules, and
 * this is unrelated operational telemetry — overloading it would mix the two
 * concerns in one table's meaning.
 *
 * `runId` is nullable so a `SETTINGS_CHANGED` event (the switch itself, not a
 * run) can still land in the same timeline without a synthetic run row.
 *
 * `payload` intentionally never carries raw log content or file bodies —
 * finder/fix summaries only. This keeps the table outside the HIPAA/PII
 * boundary those audit loggers exist for, and keeps rows cheap to render in
 * a live-updating stream.
 */
@Entity('bug_hunt_events')
@Index('idx_bug_hunt_events_run_id', ['runId'])
@Index('idx_bug_hunt_events_created_at', ['createdAt'])
@Index('idx_bug_hunt_events_finding_id', ['findingId'])
export class BugHuntEvent extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  runId?: string | null;

  @Column({ type: 'text', nullable: true })
  repo?: string | null;

  @Column({ enum: BugHuntEventStage })
  stage!: BugHuntEventStage;

  /** Short human-readable line for the timeline, e.g. "lint error in foo.ts:42". */
  @Column({ type: 'text' })
  summary!: string;

  /** Structured detail: file paths, PR URL, test names, refuted/confirmed votes, etc. No raw log/PII content. */
  @Column({ type: 'jsonb', nullable: true })
  payload?: Record<string, any> | null;

  /** Set when this event corresponds to an AnalyticsSuggestion row (the PR-review track). */
  @Column({ type: 'uuid', nullable: true })
  suggestionId?: string | null;

  /** Set when this event is about one specific BugFinding — lets the drawer show a per-finding timeline. */
  @Column({ name: 'finding_id', type: 'uuid', nullable: true })
  findingId?: string | null;
}
