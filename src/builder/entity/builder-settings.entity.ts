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
