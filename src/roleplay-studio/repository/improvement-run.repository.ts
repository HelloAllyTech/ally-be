import { Injectable } from '@nestjs/common';
import { DataSource, In, Repository } from 'typeorm';
import { ImprovementRun } from '../entity/improvement-run.entity';
import {
  IMPROVEMENT_ACTIVE_STATUSES,
  ImprovementRunStatus,
} from '../enum/improvement-run.enum';

@Injectable()
export class ImprovementRunRepository extends Repository<ImprovementRun> {
  constructor(private readonly dataSource: DataSource) {
    super(ImprovementRun, dataSource.createEntityManager());
  }

  /** RUNNING runs only — AWAITING_REVIEW does not block a new launch. */
  findActiveForSpec(specId: string): Promise<ImprovementRun | null> {
    return this.findOne({
      where: { specId, status: In(IMPROVEMENT_ACTIVE_STATUSES) },
    });
  }

  listBySpec(specId: string): Promise<ImprovementRun[]> {
    return this.find({ where: { specId }, order: { createdAt: 'DESC' } });
  }

  findAwaitingReview(specId: string): Promise<ImprovementRun | null> {
    return this.findOne({
      where: { specId, status: ImprovementRunStatus.AWAITING_REVIEW },
      order: { createdAt: 'DESC' },
    });
  }
}
