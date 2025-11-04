import { EntityManager, Repository, DataSource } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { Message } from '../entity/message.entity';

@Injectable()
export class MessageRepository extends Repository<Message> {
  constructor(private dataSource: DataSource) {
    super(Message, dataSource.createEntityManager());
  }

  async deleteMessageByChatId(
    chatId: number,
    tenantId: string,
    em?: EntityManager,
  ): Promise<boolean> {
    const messageRepo = em
      ? em.getRepository(Message)
      : this.dataSource.getRepository(Message);

    const result = await messageRepo.delete({ chatId, tenantId });
    return result.affected !== 0;
  }
}
