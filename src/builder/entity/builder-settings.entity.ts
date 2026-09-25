import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * Singleton row of platform-level Builder controls (the bug_hunter_settings
 * pattern).
 *
 * `enabled` defaults to **false**. An agent that writes code and opens pull
 * requests should not become reachable merely because a migration ran — the
 * feature toggle governs who can see the tab, and this governs whether the
 * thing behind it will actually dispatch.
 */
@Entity('builder_settings')
export class BuilderSettings extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  /**
   * Ceiling on concurrent BUILDING sessions. Each one holds a GitHub runner
   * for up to two hours, so this is a spend and capacity control, not a
   * correctness one.
   */
  @Column({ type: 'int', default: 3 })
  maxConcurrentBuilds!: number;

  /** Applied to a new session's budgetUsd. Null disables the cap. */
  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  defaultBudgetUsd?: string | null;

  /**
   * Ceiling on GitHub Actions minutes per session. Dollars and runner minutes
   * are separate budgets: a run can be cheap in tokens and still hold a runner
   * for two hours, and only one of those shows up in `totalCostUsd`.
   */
  @Column({ type: 'int', nullable: true })
  maxRunnerMinutes?: number | null;

  /**
   * Whether Builder may act on its own open pull requests — self-fixing red CI
   * and answering review comments with new commits.
   *
   * Off by default, and a separate switch from `enabled` on purpose: agreeing
   * that Builder may write code is not the same as agreeing it may keep pushing
   * to a pull request a human is in the middle of reviewing.
   */
  @Column({ type: 'boolean', default: false })
  autoFixEnabled!: boolean;

  /**
   * Whether Builder reviews its own open pull requests.
   *
   * Separate from `autoFixEnabled` on purpose, and the safer of the two: a
   * review run reads the diff and writes findings, touching no branch. Turning
   * review on while fixes stay off is the useful middle setting — the findings
   * land for a human to read, and nothing pushes.
   */
  @Column({ type: 'boolean', default: false })
  autoReviewEnabled!: boolean;

  /**
   * Whether a clean review may approve the pull request.
   *
   * The strongest of the three switches and the last one to earn trust, so it
   * is independent of the other two: review can run for weeks writing findings
   * a human reads before anyone turns this on. What it buys is the step that
   * actually blocked every Builder PR — `master` needs an approving review, the
   * bot has only `write`, and so a green, reviewed, finding-free pull request
   * still waited on a human to click Approve or an admin to override branch
   * protection entirely.
   *
   * It never forces: the approval is a normal review, every other required
   * check still has to pass, and a human can dismiss it like any other.
   */
  @Column({ type: 'boolean', default: false })
  autoApproveEnabled!: boolean;

  /**
   * Whether a clean review may merge the pull request.
   *
   * The last click Builder was still waiting on, and the only step in the
   * chain that cannot be undone from here — so it keeps its own switch rather
   * than riding on `autoApproveEnabled`, and can be turned off again without
   * a deploy. Everything it rests on is checked afresh at merge time: green
   * checks, a review that PASSED on this exact commit, nothing actionable
   * outstanding, and GitHub's own `mergeable_state`.
   *
   * It never forces. When any of that does not hold it declines and falls back
   * to the merge button a person clicks, so the work stops in front of someone
   * rather than stopping silently.
   *
   * Worth knowing what it composes with: `autoReleaseEnabled` ships a merged
   * pull request to production. Both on means a green, clean-reviewed change
   * reaches real users with nobody in the loop at all.
   */
  @Column({ type: 'boolean', default: false })
  autoMergeEnabled!: boolean;

  /**
   * Whether a merged pull request releases itself to production.
   *
   * The furthest Builder goes, and the only switch here that changes what real
   * users are running. Gated on more than the others: the repo must have a
   * dispatchable release pipeline, and for ally-web every changed file must
   * attribute to exactly the apps being released — a change under `libs/` ships
   * inside all three frontends, and releasing the subset whose paths happened to
   * match would silently under-deploy it.
   *
   * A release that fails leaves the pull request merged but not deployed, which
   * is worse than not having released at all if nobody is told. That is why the
   * watcher exists and why a failure notifies rather than just logging.
   */
  @Column({ type: 'boolean', default: false })
  autoReleaseEnabled!: boolean;

  /**
   * Fix runs per pull request. A fix that cannot fix it will not fix it on the
   * fourth attempt either, and the failure mode without a ceiling is a loop
   * that pushes commits until someone notices the bill.
   */
  @Column({ type: 'int', default: 3 })
  maxFixRunsPerPr!: number;

  @Column({ type: 'varchar', length: 40, nullable: true })
  defaultEngine?: string | null;

  /** Legacy coder-tier default; `coderModel` wins when both are set. */
  @Column({ type: 'varchar', length: 80, nullable: true })
  defaultModel?: string | null;

  /**
   * Per-tier model overrides for the tiered loop. Null falls through to the
   * env override and then BUILDER_MODEL_DEFAULTS — resolution order per run:
   * StartBuildDto → session (coder only) → these → config.
   */
  @Column({ type: 'varchar', length: 80, nullable: true })
  plannerModel?: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  coderModel?: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  verifierModel?: string | null;

  @Column({ type: 'int', nullable: true })
  updatedBy?: number | null;
}
