import { Injectable } from '@nestjs/common';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import { RehearsalRun } from '../entity/rehearsal-run.entity';
import { REHEARSAL_PENDING_STATUSES } from '../constants/roleplay-studio.constants';
import { TIME } from 'src/common/constants/time.constants';

@Injectable()
export class RehearsalRunRepository extends Repository<RehearsalRun> {
  constructor(private readonly dataSource: DataSource) {
    super(RehearsalRun, dataSource.createEntityManager());
  }

  findPendingForVersion(specVersionId: string): Promise<RehearsalRun[]> {
    return this.find({
      where: { specVersionId, status: In(REHEARSAL_PENDING_STATUSES) },
    });
  }

  listBySpec(specId: string, specVersionId?: string): Promise<RehearsalRun[]> {
    return this.find({
      where: specVersionId ? { specId, specVersionId } : { specId },
      order: { createdAt: 'DESC' },
    });
  }

  findStalePendingRuns(timeoutMinutes: number): Promise<RehearsalRun[]> {
    const cutoff = new Date(Date.now() - timeoutMinutes * TIME.MINUTE_IN_MS);
    return this.find({
      where: {
        status: In(REHEARSAL_PENDING_STATUSES),
        createdAt: LessThan(cutoff),
      },
    });
  }

  findRecentByCreatedBy(
    createdBy: number,
    lookbackMinutes?: number,
  ): Promise<RehearsalRun[]> {
    const qb = this.createQueryBuilder('run').where(
      'run.createdBy = :createdBy',
      { createdBy },
    );
    if (lookbackMinutes) {
      const sinceDate = new Date(
        Date.now() - lookbackMinutes * TIME.MINUTE_IN_MS,
      );
      qb.andWhere(
        '(run.status IN (:...pending) OR run.createdAt >= :sinceDate OR run.endedAt >= :sinceDate)',
        { pending: REHEARSAL_PENDING_STATUSES, sinceDate },
      );
    }
    return qb.orderBy('run.createdAt', 'DESC').getMany();
  }
}
