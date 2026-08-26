import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseWithoutTenantEntity } from 'src/common/entity/base-without-tenant.entity';

/**
 * A pull request this session opened. Unique per `(sessionId, repo)`: a
 * resume run pushes more commits to the same branch, which updates the
 * existing PR rather than opening a second one.
 *
 * `ciStatus` and `merged` are refreshed by the reconcile pass, because the
 * interesting half of a PR's life happens after Builder stops watching — CI
 * runs, a human reviews, someone merges. Without the refresh the session view
 * would freeze at "opened" forever.
 */
@Entity('builder_pull_requests')
@Index('idx_builder_pull_requests_session_repo', ['sessionId', 'repo'], {
  unique: true,
})
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

  /** GitHub check-run rollup: success / failure / pending / null when unknown. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  ciStatus?: string | null;

  @Column({ type: 'boolean', default: false })
  merged!: boolean;

  @Column({ type: 'timestamp', nullable: true })
  mergedAt?: Date | null;
}
