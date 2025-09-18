import { Injectable } from '@nestjs/common';
import { Chat } from 'src/common/entities/chat.entity';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { UpdateChatInput } from '../type/chat.type';

@Injectable()
export class ChatRepository extends Repository<Chat> {
  constructor(private dataSource: DataSource) {
    super(Chat, dataSource.createEntityManager());
  }

  async updateChat(
    chatId: number,
    input: UpdateChatInput,
    em?: EntityManager,
  ): Promise<boolean> {
    const chatRepo = em
      ? em.getRepository(Chat)
      : this.dataSource.getRepository(Chat);

    const queryBuilder = chatRepo.createQueryBuilder('chat').update();

    const setObj: Record<string, any> = {};

    if (input.summaryStatus !== undefined) {
      setObj.summaryStatus = input.summaryStatus;
    }

    if (input.metadata !== undefined) {
      setObj.metadata = () =>
        `"metadata" || '${JSON.stringify([input.metadata])}'::jsonb`;
    }

    if (Object.keys(setObj).length > 0) {
      queryBuilder.set(setObj);
    }

    const updatedResult = await queryBuilder
      .where('id = :chatId', { chatId })
      .execute();

    return updatedResult.affected !== 0;
  }

  async deleteChat(chatId: number, em?: EntityManager): Promise<boolean> {
    const chatRepo = em
      ? em.getRepository(Chat)
      : this.dataSource.getRepository(Chat);

    const result = await chatRepo.delete(chatId);
    return result.affected !== 0;
  }
}
