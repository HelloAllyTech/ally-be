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

  @Column({ type: 'boolean', default: false })
  merged!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  mergedAt?: Date | null;
}
