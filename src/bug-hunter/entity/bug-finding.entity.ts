import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

import {
  BugFindingSeverity,
  BugFindingSource,
  BugFindingStatus,
} from '../enum/bug-finding.enum';

/**
 * One bug, from any source Bug Hunter knows about — the single comprehensive
 * table the admin tab renders, replacing the earlier design where a hunt run's
 * findings lived only as ephemeral objects inside one workflow invocation
 * (never persisted individually) and only human-reported bugs had any
 * standing row at all (as a `roadmap_opportunities` item).
 *
 * A row can exist before any hunt run has looked at it: `RoadmapOpportunityService.create`
 * inserts one directly (source=reported_bug, status=new) the moment a human
 * files a bug on the roadmap, so the table is a complete bug inbox regardless
 * of whether Bug Hunter's pipeline has triaged it yet. Every other source only
 * ever gets a row via `POST pipeline/runs/:id/findings`.
 *
 * `dedupeKey` + `repo` is how re-running the same finders across nights avoids
 * spamming duplicate rows for a bug that's still open — see
 * BugFindingRepository.findOpenByDedupeKey. It stays null for reported-bug and
 * analytics-suggestion rows, which dedupe by `reportedBugId` / the backfill
 * migration instead.
 *
 * The CHECK constraints live in migration 1898000000000 only — TypeORM cannot
 * express them and `migration:generate` would propose dropping them. Never
 * generate migrations against this table.
 */
@Entity('bug_findings')
@Index('idx_bug_findings_status', ['status'])
@Index('idx_bug_findings_repo_dedupe_key', ['repo', 'dedupeKey'])
@Index('idx_bug_findings_reported_bug_id', ['reportedBugId'])
export class BugFinding extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The hunt run that most recently touched this finding. Null for a reported bug no run has triaged yet. */
  @Column({ name: 'run_id', type: 'uuid', nullable: true })
  runId?: string | null;

  /** Null for a freshly-reported bug — roadmap items aren't repo-scoped until a finder judges which repo it's about. */
  @Column({ type: 'text', nullable: true })
  repo?: string | null;

  @Column({ enum: BugFindingSource })
  source!: BugFindingSource;

  /** Short line for the table — the finder's one-line description, capped at 200 chars. */
  @Column({ type: 'text' })
  title!: string;

  /** Fuller detail for the drawer: the finder's description, or the human's own report text. */
  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'text', nullable: true })
  file?: string | null;

  /** Exact failure output, log excerpt, or report text the finder cited. */
  @Column({ type: 'text', nullable: true })
  evidence?: string | null;

  /** Null until a finder judges it — a freshly-reported bug has no severity yet. */
  @Column({ type: 'varchar', enum: BugFindingSeverity, nullable: true })
  severity?: BugFindingSeverity | null;

  /** True for test/lint/log findings (ground truth); false for anything that still needs adversarial verification. */
  @Column({ type: 'boolean', default: false })
  proven!: boolean;

  /** Migrations, auth/permission gating, payments — never eligible for auto-merge regardless of diff size. */
  @Column({ name: 'touches_guarded_path', type: 'boolean', default: false })
  touchesGuardedPath!: boolean;

  /** The roadmap_opportunities row this came from, for source=reported_bug. ON DELETE SET NULL — see migration. */
  @Column({ name: 'reported_bug_id', type: 'uuid', nullable: true })
  reportedBugId?: string | null;

  /** `repo + normalized(file + description)`, hashed. Null for sources that dedupe another way — see class doc. */
  @Column({ name: 'dedupe_key', type: 'text', nullable: true })
  dedupeKey?: string | null;

  @Column({
    enum: BugFindingStatus,
    default: BugFindingStatus.NEW,
  })
  status!: BugFindingStatus;

  @Column({ name: 'pr_url', type: 'text', nullable: true })
  prUrl?: string | null;

  /** Set when the fix agent hits a genuine open product question — see BugFindingStatus.NEEDS_INPUT. */
  @Column({ name: 'escalation_question', type: 'text', nullable: true })
  escalationQuestion?: string | null;

  @Column({ name: 'escalation_answer', type: 'text', nullable: true })
  escalationAnswer?: string | null;

  /** Integer users.id with NO foreign key, per ally-be convention. */
  @Column({ name: 'escalation_answered_by', type: 'int', nullable: true })
  escalationAnsweredBy?: number | null;

  @Column({ name: 'escalation_answered_at', type: 'timestamp', nullable: true })
  escalationAnsweredAt?: Date | null;

  /** Who approved/rejected this in Manual mode, or dismissed a completed one. Integer users.id, no FK. */
  @Column({ name: 'decided_by', type: 'int', nullable: true })
  decidedBy?: number | null;

  @Column({ name: 'decided_at', type: 'timestamp', nullable: true })
  decidedAt?: Date | null;

  /** Free-form: verify-vote tally, fix-attempt count, etc. */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;
}
