import { DataSource, EntityManager } from 'typeorm';
import { QueueEntry } from '../entity/queue-entry.entity';
import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ExecutionManager } from 'src/common/execution/execution-manager';

@Injectable()
export class QueueRepository extends Repository<QueueEntry> {
  constructor(private readonly dataSource: DataSource) {
    super(QueueEntry, dataSource.createEntityManager());
  }

  async getQueueStats(
    status?: string,
    em?: EntityManager,
  ): Promise<QueueEntry[]> {
    const repo = em?.getRepository(QueueEntry) || this;
    const query = repo
      .createQueryBuilder('queue')
      .where('queue.tenantId = :tenantId', {
        tenantId: ExecutionManager.getTenantId(),
      })
      .orderBy('queue.priority', 'DESC')
      .addOrderBy('queue.waitStartTime', 'ASC');

    if (status) {
      query.andWhere('queue.status = :status', { status });
    }

    return query.getMany();
  }
}
