import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueueEntry } from '../../common/entities/queue.entity';
import { Repository } from 'typeorm';
import { QueueStatus } from '../../common/constants/chat.constants';
import { ChatService } from '../../chat/services/chat.service';

@Injectable()
export class QueueService {
  constructor(
    @InjectRepository(QueueEntry)
    private queueRepo: Repository<QueueEntry>,
    @Inject(forwardRef(() => ChatService))
    private chatService: ChatService,
  ) {}

  async enqueue(data: { userId: number; chatId: number; priority: number }) {
    const queueEntry = this.queueRepo.create({
      clientId: data.userId,
      chatId: data.chatId,
      priority: data.priority,
      waitStartTime: new Date(),
    });
    return this.queueRepo.save(queueEntry);
  }

  async getStats(status?: string) {
    const query = this.queueRepo
      .createQueryBuilder('queue')
      .orderBy('queue.priority', 'DESC')
      .addOrderBy('queue.waitStartTime', 'ASC');
    if (status) {
      query.where('queue.status = :status', { status });
    }
    const stats = await query.getMany();
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
    return this.queueRepo.find({
      where: {
        status: QueueStatus.WAITING,
      },
    });
  }

  getQueueByChatId(chatId: number) {
    return this.queueRepo.findOne({ where: { chatId } });
  }

  updateQueueStatus(id: any, status: QueueStatus) {
    return this.queueRepo.update(id, { status });
  }
}
