import { Injectable } from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';
import { RoleplayTestRun } from '../entity/roleplay-test-run.entity';
import { TEST_RUN_PENDING_STATUSES } from '../constants/roleplay-studio.constants';

@Injectable()
export class RoleplayTestRunRepository extends Repository<RoleplayTestRun> {
  constructor(private readonly dataSource: DataSource) {
    super(RoleplayTestRun, dataSource.createEntityManager());
  }

  /** Non-terminal runs for a spec — at most one is allowed at a time. */
  findPendingForSpec(specId: string): Promise<RoleplayTestRun[]> {
    return this.find({
      where: { specId, status: In(TEST_RUN_PENDING_STATUSES) },
    });
  }

  listBySpec(specId: string): Promise<RoleplayTestRun[]> {
    return this.find({
      where: { specId },
      order: { createdAt: 'DESC' },
    });
  }
}
