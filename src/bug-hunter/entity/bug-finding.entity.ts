import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';
import { RoadmapOpportunityStage } from 'src/product-roadmap/enum/roadmap-opportunity.enum';

import {
  BugFindingDecisionReason,
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
 * The key is built from `file` + `source` + `symbol` (falling back to a
 * normalised fingerprint of the description). It deliberately does NOT hash
 * the raw description: that text is LLM-generated, so hashing it meant the
 * same bug worded differently opened a duplicate row — see migration
 * 1910000000000.
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

  /**
   * The finder's or reporter's own words, kept from the FIRST edit onwards —
   * `description` above is then whatever an admin last rewrote it to.
   *
   * Null means nobody has edited it, i.e. `description` is still original.
   * Never overwritten by a later edit: the point is to preserve what Bug
   * Hunter actually found, so a reviewer whose fix went wrong can tell whether
   * the agent misread the bug or was handed a bad brief.
   */
  @Column({ name: 'original_description', type: 'text', nullable: true })
  originalDescription?: string | null;

  /** The admin who last rewrote the description. Integer users.id with NO foreign key, per ally-be convention. */
  @Column({ name: 'description_edited_by', type: 'int', nullable: true })
  descriptionEditedBy?: number | null;

  @Column({ name: 'description_edited_at', type: 'timestamp', nullable: true })
  descriptionEditedAt?: Date | null;

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

  /**
   * Function, class, route, component or endpoint this finding sits on — the
   * stable half of the dedupe key. Null when the finder did not supply one, in
   * which case dedup falls back to a normalised description fingerprint.
   */
  @Column({ type: 'text', nullable: true })
  symbol?: string | null;

  /** `hash(file + source + symbol-or-description-fingerprint)`. Null for sources that dedupe another way — see class doc. */
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

  /**
   * Why this bug was declined — required on every reject, and on every
   * verifier dismissal.
   *
   * Two readers, only one of them human: the next sweep is shown recent
   * finder-error declines as "do not re-file these" (see `buildSweepPrompt`),
   * and `BugHunterMetricsService` divides by them to answer how often Bug
   * Hunter is right. Before this column both were impossible — `reject()`
   * recorded who and when and nothing about what they concluded — so the same
   * non-bug came back nightly and nobody could say whether the agent's
   * judgement was improving.
   *
   * Null on every row that was not declined, and on rows declined before this
   * column existed. `character varying` + CHECK, per repo convention.
   */
  @Column({ name: 'decision_reason', type: 'varchar', nullable: true })
  decisionReason?: BugFindingDecisionReason | null;

  /**
   * The half of the explanation a six-value taxonomy cannot carry, in the
   * decider's own words. Optional on purpose: making it mandatory would push
   * people towards the reason that needs least typing, which corrupts the
   * counted field for the sake of the uncounted one.
   */
  @Column({ name: 'decision_note', type: 'text', nullable: true })
  decisionNote?: string | null;

  // ── roadmap stage, shown here because bugs are no longer on the board ───────

  /**
   * A hand-set stage that OVERRIDES the one derived from `status` — see
   * bug-finding-stage.util.ts. Null (the norm) means the stage is derived, so it
   * tracks the pipeline with nothing to maintain.
   *
   * Exists for the bug fixed outside Bug Hunter entirely: a hand-written PR, a
   * config change, a fix that rode along with unrelated work. The pipeline never
   * saw any of that, so its status stays at NEW while the bug is in fact shipped,
   * and only a human can say so.
   *
   * Stored on the FINDING rather than on the linked roadmap row on purpose. Most
   * findings (every sweep-discovered one) have no `reportedBugId` at all, and a
   * stage that existed for human-reported bugs only would be a column the table
   * could not sort or filter by.
   *
   * `character varying` with a CHECK constraint listing the RoadmapOpportunityStage
   * values, per repo convention — see migration 1936000000000.
   */
  @Column({ name: 'stage_override', type: 'varchar', nullable: true })
  stageOverride?: RoadmapOpportunityStage | null;

  /** The admin who pinned the stage. Integer users.id with NO foreign key, per ally-be convention. */
  @Column({ name: 'stage_overridden_by', type: 'int', nullable: true })
  stageOverriddenBy?: number | null;

  @Column({ name: 'stage_overridden_at', type: 'timestamp', nullable: true })
  stageOverriddenAt?: Date | null;

  // ── coordinated multi-repo fixes (migration 1900000000000) ──────────────────

  /**
   * Set on a CHILD step, pointing at the bug it is one part of.
   *
   * A fix session only ever has one repo checked out, so a bug needing changes
   * in two repos becomes a parent plus one child per repo. The parent is the
   * bug as a human reported it; the children are the units of work. Children
   * are created by `BugFixSessionService.recordPlan` from a plan the first fix
   * agent reported, never by a finder.
   */
  @Column({ name: 'parent_finding_id', type: 'uuid', nullable: true })
  parentFindingId?: string | null;

  /**
   * A child's position in its parent's plan, 0-based. THE ORDER IS THE POINT:
   * steps run one at a time in this order and release in this order, because
   * shipping a frontend before the backend field it reads exists is exactly
   * the production break this whole feature is trying to avoid. Null on a
   * parent and on any standalone finding.
   */
  @Column({ name: 'step_index', type: 'int', nullable: true })
  stepIndex?: number | null;

  /** What this step has to change, in the planning agent's words — shown as the plan in the parent's drawer. */
  @Column({ name: 'step_summary', type: 'text', nullable: true })
  stepSummary?: string | null;

  // ── on-demand fix session + release to production (migration 1899000000000) ──

  /**
   * When the most recent dispatch — fix session or release — was accepted by
   * GitHub. `POST .../workflows/{file}/dispatches` returns 204 with no body,
   * so until the reconcile task resolves an actual run id this timestamp is
   * the only thing identifying which Actions run was ours.
   */
  @Column({ name: 'dispatched_at', type: 'timestamp', nullable: true })
  dispatchedAt?: Date | null;

  /** Link to the GitHub Actions run doing the fixing, once resolved — the drawer's "watch it work" link. */
  @Column({ name: 'session_run_url', type: 'text', nullable: true })
  sessionRunUrl?: string | null;

  /**
   * GitHub Actions run id for the fix-session workflow, once resolved —
   * mirrors `releaseRunId`. `bigint` → string in JS. Null until the reconcile
   * task correlates the dispatch to a run (`workflow_dispatch` returns 204
   * with no run id — see GithubActionsService's class doc), which is also the
   * window during which "Stop fix session" must resolve one itself before it
   * can call `GithubActionsService.cancelRun` — see
   * BugFixSessionService.cancelFixSession.
   */
  @Column({ name: 'session_run_id', type: 'bigint', nullable: true })
  sessionRunId?: string | null;

  /** The version tag this fix shipped under, e.g. `v1.4.2` or `admin-v2.1.0`. */
  @Column({ name: 'release_tag', type: 'text', nullable: true })
  releaseTag?: string | null;

  /** GitHub Actions run id for the production-release workflow. `bigint` → string in JS. */
  @Column({ name: 'release_run_id', type: 'bigint', nullable: true })
  releaseRunId?: string | null;

  @Column({ name: 'release_run_url', type: 'text', nullable: true })
  releaseRunUrl?: string | null;

  /** The admin who pressed "Release to production" — the human gate on an LLM-authored diff reaching prod. Integer users.id, no FK. */
  @Column({ name: 'released_by', type: 'int', nullable: true })
  releasedBy?: number | null;

  /** When the release workflow finished green, NOT when it was dispatched. */
  @Column({ name: 'released_at', type: 'timestamp', nullable: true })
  releasedAt?: Date | null;

  // ── manual kill switch (migration 1911000000000) ─────────────────────────

  /** The admin who pressed "Stop fix session" — the human override on a session that's clearly stuck or looping. Integer users.id, no FK. */
  @Column({ name: 'cancelled_by', type: 'int', nullable: true })
  cancelledBy?: number | null;

  @Column({ name: 'cancelled_at', type: 'timestamp', nullable: true })
  cancelledAt?: Date | null;

  /**
   * Free-form: verify-vote tally, fix-attempt count, etc.
   *
   * Keys other code reads, kept here because a JSONB column with undocumented
   * consumers is the same as no column:
   *
   *  - `confidence` (0-1) — the Verify phase's lowest verifier certainty for
   *    this finding. Absent on proven findings (nothing to verify) and on rows
   *    from before verifiers reported one. Below
   *    `BUG_HUNT_LOW_CONFIDENCE_THRESHOLD` the sweep holds the finding for a
   *    human even in AI mode, and the metrics endpoint cuts accept rate by it.
   *  - `verifierVotes` — the individual refute verdicts behind that number, so
   *    a reader can tell "all three were unsure" from "two were certain and
   *    one dissented".
   *  - `regressionOf` — the id of the earlier finding this one is a return of,
   *    set when a shipped fix did not hold (see `persistFindings`).
   *  - `regressed` — set true on THAT earlier finding, so the row whose fix
   *    failed says so without a join.
   *  - `rediscoveredCount` — how many sweeps have re-found a bug that was
   *    already declined. A high count is the sweep arguing with a human, and
   *    worth seeing.
   */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;
}
