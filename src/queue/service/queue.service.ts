import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { QueueStatus } from '../../common/constants/chat.constants';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { QueueRepository } from '../repository/queue.repository';

@Injectable()
export class QueueService {
  constructor(private queueRepo: QueueRepository) {}

  async enqueue(
    data: { userId: number; chatId: number; priority: number },
    entityManager?: EntityManager,
  ) {
    return this.queueRepo.enqueue(
      {
        clientId: data.userId,
        chatId: data.chatId,
        priority: data.priority,
        waitStartTime: new Date(),
        tenantId: ExecutionManager.getTenantId()!,
      },
      entityManager,
    );
  }

  async getStats(status?: string, entityManager?: EntityManager) {
    const stats = await this.queueRepo.getStats(
      status,
      ExecutionManager.getTenantId()!,
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
    return this.queueRepo.getWaitingClients(ExecutionManager.getTenantId()!);
  }

  getQueueByChatId(chatId: number, entityManager?: EntityManager) {
    return this.queueRepo.getQueueByChatId(
      chatId,
      ExecutionManager.getTenantId()!,
      entityManager,
    );
  }

  updateQueueStatus(
    id: any,
    status: QueueStatus,
    entityManager?: EntityManager,
  ) {
    return this.queueRepo.updateQueueStatus(
      id,
      status,
      ExecutionManager.getTenantId()!,
      entityManager,
    );
  }
}
