import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * A pull request this session opened. Unique per `(sessionId, repo, branch)`:
 * a resume run pushes more commits to the same branch, which updates the
 * existing PR rather than opening a second one — but an epic opens one per
 * repo per milestone, each on its own branch, so the branch is part of the key.
 *
 * `ciStatus` and `merged` are refreshed by the reconcile pass, because the
 * interesting half of a PR's life happens after Builder stops watching — CI
 * runs, a human reviews, someone merges. Without the refresh the session view
 * would freeze at "opened" forever.
 */
@Entity('builder_pull_requests')
@Index(
  'idx_builder_pull_requests_session_repo_branch',
  ['sessionId', 'repo', 'branch'],
  { unique: true },
)
export class BuilderPullRequest extends BaseWithoutTenantEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  sessionId!: string;

  @Column({ type: 'uuid', nullable: true })
  runId?: string | null;

  @Column({ type: 'varchar', length: 80 })
  repo!: string;

  @Column({ type: 'varchar', length: 200 })
  branch!: string;

  @Column({ type: 'int' })
  prNumber!: number;

  @Column({ type: 'text' })
  prUrl!: string;

  @Column({ type: 'text', nullable: true })
  title?: string | null;

  /**
   * GitHub check rollup: success / failure / pending / none / null when never
   * read. `none` and `success` are different facts — a repo with no CI at all
   * must not read as green, or the auto-fix decision would trust nothing.
   */
  @Column({ type: 'varchar', length: 20, nullable: true })
  ciStatus?: string | null;

  /**
   * open / closed. Distinct from `merged`: a PR closed *without* merging is a
   * rejection, and to the flywheel that is the most informative outcome there
   * is. Before this column the two were indistinguishable.
   */
  @Column({ type: 'varchar', length: 20, nullable: true })
  state?: string | null;

  /**
   * Head commit at the last reconcile. A red rollup is only Builder's problem
   * when it is red on a sha Builder pushed — if a human pushed to the branch,
   * their breakage is not ours to auto-fix.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  headSha?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastCheckedAt?: Date | null;

  /**
   * How many fix runs this PR has already had. The self-limit on a fix loop
   * that cannot actually fix the thing: incremented at dispatch, so a crashing
   * run still counts against the ceiling.
   */
  @Column({ type: 'int', default: 0 })
  fixRunCount!: number;

  /**
   * How many review runs this PR has had. Bounded for the same reason fix runs
   * are: a reviewer dispatched on every reconcile tick would re-read an
   * unchanged diff every few minutes and bill for it.
   */
  @Column({ type: 'int', default: 0 })
  reviewRunCount!: number;

  /**
   * The head commit the last review run read.
   *
   * Stored rather than a bare timestamp so a re-review can tell "already
   * reviewed this exact code" from "reviewed an older version of it" — the
   * distinction any future re-review-after-fix depends on.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  reviewedSha?: string | null;

  /**
   * Where this pull request's production release has got to.
   *
   * Null means nothing was dispatched — the ordinary state for a PR that has
   * not merged, and the permanent state for one whose repo has no dispatchable
   * release pipeline. `failed` is the one that matters: it means **merged but
   * not deployed**, which is the state a person has to act on.
   */
  @Column({ type: 'varchar', length: 12, nullable: true })
  releaseState?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  releaseTag?: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  releaseRunId?: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  releaseRunUrl?: string | null;

  /**
   * When the dispatch was accepted. Not cosmetic: `workflow_dispatch` answers
   * 204 with no body, so the run it created can only be found afterwards by
   * workflow and time.
   */
  @Column({ type: 'timestamp', nullable: true })
  releaseDispatchedAt?: Date | null;

  /**
   * When the merge button was offered in Slack.
   *
   * Reconcile is polled, so without this a pull request that sits mergeable for
   * an afternoon would post a fresh button every tick — which is how a channel
   * with one useful message becomes a channel nobody reads.
   */
  @Column({ type: 'timestamp', nullable: true })
  mergePromptedAt?: Date | null;

  @Column({ type: 'boolean', default: false })
  merged!: boolean;

  /**
   * Who pressed Merge in the Builder drawer, when that is how it merged.
   *
   * NULL for a pull request merged on GitHub, which is most of them — the
   * column records a decision made *here*, not the merge itself, and
   * conflating the two would make "did anyone use this button" unanswerable.
   * The CI gate and the required review both still apply; the button removes
   * the errand, never the judgement.
   */
  @Column({ type: 'int', nullable: true })
  decidedBy?: number | null;

  @Column({ type: 'timestamp', nullable: true })
  mergedAt?: Date | null;
}
