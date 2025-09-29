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

    const updateData = Object.fromEntries(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      Object.entries(input).filter(([key, value]) => value !== undefined),
    );

    if (Object.keys(updateData).length === 0) {
      return false;
    }

    const result = await chatRepo.update(chatId, updateData);
    return result.affected !== 0;
  }

  async deleteChat(chatId: number, em?: EntityManager): Promise<boolean> {
    const chatRepo = em
      ? em.getRepository(Chat)
      : this.dataSource.getRepository(Chat);

    const result = await chatRepo.delete(chatId);
    return result.affected !== 0;
  }
}
