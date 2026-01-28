import { Injectable } from '@nestjs/common';
import { QueueEntry } from '../entity/queue-entry.entity';
import { EntityManager } from 'typeorm';
import { QueueStatus } from '../../common/constants/chat.constants';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { QueueRepository } from '../repository/queue.repository';

@Injectable()
export class QueueService {
  constructor(private queueRepository: QueueRepository) {}

  async enqueue(
    data: { userId: number; chatId: number; priority: number },
    entityManager?: EntityManager,
  ) {
    const repo =
      entityManager?.getRepository(QueueEntry) || this.queueRepository;
    const queueEntry = repo.create({
      clientId: data.userId,
      chatId: data.chatId,
      priority: data.priority,
      waitStartTime: new Date(),
      tenantId: ExecutionManager.getTenantId(),
    });
    return repo.save(queueEntry);
  }

  async getStats(status?: string, entityManager?: EntityManager) {
    const stats = await this.queueRepository.getQueueStats(
      status,
      entityManager,
    );
    return stats.map((stat) => ({
      entryId: stat.entryId,
      clientId: stat.clientId,
      chatId: stat.chatId,
      priority: stat.priority,
      waitStartTime: stat.waitStartTime,
      status: stat.status,
    }));
  }

  async getWaitingClients() {
    return this.queueRepository.find({
      where: {
        status: QueueStatus.WAITING,
        tenantId: ExecutionManager.getTenantId(),
      },
    });
  }

  getQueueByChatId(chatId: number, entityManager?: EntityManager) {
    const repo =
      entityManager?.getRepository(QueueEntry) || this.queueRepository;
    return repo.findOne({
      where: { chatId, tenantId: ExecutionManager.getTenantId() },
    });
  }

  updateQueueStatus(
    id: any,
    status: QueueStatus,
    entityManager?: EntityManager,
  ) {
    const repo =
      entityManager?.getRepository(QueueEntry) || this.queueRepository;
    return repo.update(
      { entryId: id, tenantId: ExecutionManager.getTenantId() },
      { status },
    );
  }
}
