import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { BuilderSession } from '../entity/builder-session.entity';
import { BuilderSessionStatus } from '../enum/builder.enum';

@Injectable()
export class BuilderSessionRepository extends Repository<BuilderSession> {
  constructor(private readonly dataSource: DataSource) {
    super(BuilderSession, dataSource.createEntityManager());
  }

  /**
   * Sessions that ended badly, newest first.
   *
   * For the outcome sweep, which re-tests a FAILED verdict against what the
   * session's pull requests actually did. Bounded rather than exhaustive: a
   * verdict nobody has looked at in weeks is not what this is for, and an
   * unbounded scan on every tick is how a cheap sweep becomes a slow one.
   */
  listRecentlyFailed(take = 50): Promise<BuilderSession[]> {
    return this.find({
      where: { status: BuilderSessionStatus.FAILED },
      order: { updatedAt: 'DESC' },
      take,
    });
  }

  /**
   * True when the slug is already taken. Checked against soft-deleted rows
   * too: the branch those sessions pushed still exists on the remote, so
   * reusing the name would push onto someone else's history.
   */
  async slugExists(slug: string): Promise<boolean> {
    const count = await this.count({ where: { slug }, withDeleted: true });
    return count > 0;
  }

  /**
   * Display name of the admin who started a session, for the exported PRD's
   * "Built by" line. Read by raw query rather than through UserService: the
   * builder module has no reason to depend on the user module for one column,
   * and importing from `src/user/service/*` is a known boot-time cycle risk.
   *
   * Falls back to the email when the name is blank (bulk-created accounts
   * leave it empty), and to null when the user row is gone.
   */
  async findCreatorName(
    userId: number | null | undefined,
  ): Promise<string | null> {
    if (!userId) return null;
    const rows: { label: string | null }[] = await this.dataSource.query(
      `SELECT COALESCE(NULLIF(TRIM(name), ''), email) AS label FROM users WHERE id = $1`,
      [userId],
    );
    return rows[0]?.label ?? null;
  }
}
