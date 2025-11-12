import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { QueueEntry } from '../entity/queue-entry.entity';
import { QueueStatus } from '../../common/constants/chat.constants';

@Injectable()
export class QueueRepository extends Repository<QueueEntry> {
  constructor(private dataSource: DataSource) {
    super(QueueEntry, dataSource.createEntityManager());
  }

  async enqueue(
    data: {
      clientId: number;
      chatId: number;
      priority: number;
      waitStartTime: Date;
      tenantId: string;
    },
    entityManager?: EntityManager,
  ): Promise<QueueEntry> {
    const repository = entityManager
      ? entityManager.getRepository(QueueEntry)
      : this;
    const queueEntry = repository.create(data);
    return repository.save(queueEntry);
  }

  async getStats(
    status: string | undefined,
    tenantId: string,
    entityManager?: EntityManager,
  ): Promise<QueueEntry[]> {
    const repository = entityManager
      ? entityManager.getRepository(QueueEntry)
      : this;
    const query = repository
      .createQueryBuilder('queue')
      .orderBy('queue.priority', 'DESC')
      .addOrderBy('queue.waitStartTime', 'ASC');

    if (status) {
      query.where('queue.status = :status', { status });
    }

    query.andWhere('queue.tenantId = :tenantId', { tenantId });

    return query.getMany();
  }

  async getWaitingClients(
    tenantId: string,
    entityManager?: EntityManager,
  ): Promise<QueueEntry[]> {
    const repository = entityManager
      ? entityManager.getRepository(QueueEntry)
      : this;
    return repository.find({
      where: {
        status: QueueStatus.WAITING,
        tenantId,
      },
    });
  }

  async getQueueByChatId(
    chatId: number,
    tenantId: string,
    entityManager?: EntityManager,
  ): Promise<QueueEntry | null> {
    const repository = entityManager
      ? entityManager.getRepository(QueueEntry)
      : this;
    return repository.findOne({
      where: { chatId, tenantId },
    });
  }

  async updateQueueStatus(
    id: number,
    status: QueueStatus,
    tenantId: string,
    entityManager?: EntityManager,
  ): Promise<boolean> {
    const repository = entityManager
      ? entityManager.getRepository(QueueEntry)
      : this;
    const result = await repository.update(
      { entryId: id, tenantId },
      { status },
    );
    return result.affected !== 0;
  }
}
