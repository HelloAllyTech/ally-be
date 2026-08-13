import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { BugHuntRun } from '../entity/bug-hunt-run.entity';

@Injectable()
export class BugHuntRunRepository extends Repository<BugHuntRun> {
  constructor(dataSource: DataSource) {
    super(BugHuntRun, dataSource.createEntityManager());
  }

  /** Run history, newest first — the admin tab's table. */
  listRecent(limit: number): Promise<BugHuntRun[]> {
    return this.find({ order: { createdAt: 'DESC' }, take: limit });
  }

  /**
   * The last COMPLETED run for a repo, regardless of trigger — the nightly
   * sweep's diff-scoping reads its `createdAt` as "changed since here" so a
   * skipped/failed run never resets the diff window back to the beginning.
   */
  findLastCompleted(repo: string): Promise<BugHuntRun | null> {
    return this.findOne({
      where: { repo, status: 'completed' as BugHuntRun['status'] },
      order: { createdAt: 'DESC' },
    });
  }
}
