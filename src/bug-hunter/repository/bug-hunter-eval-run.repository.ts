import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';

import { BugHunterEvalRun } from '../entity/bug-hunter-eval-run.entity';

@Injectable()
export class BugHunterEvalRunRepository extends Repository<BugHunterEvalRun> {
  constructor(dataSource: DataSource) {
    super(BugHunterEvalRun, dataSource.createEntityManager());
  }

  /** Newest first, optionally one repo — the list behind the eval panel. */
  listRecent(limit: number, repo?: string): Promise<BugHunterEvalRun[]> {
    return this.find({
      where: repo ? { repo } : {},
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
