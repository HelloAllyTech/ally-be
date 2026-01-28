import { EntityManager, Repository, DataSource } from 'typeorm';
import { Injectable } from '@nestjs/common';
import { Message, MessageType } from '../entity/message.entity';
import { Feedback } from '../entity/feedback.entity';
import { User } from 'src/user/entity/user.entity';
import { MessageSortBy } from '../enum/message-sort-by.enum';
import { MessageFilter } from '../type/message.type';

@Injectable()
export class MessageRepository extends Repository<Message> {
  constructor(private dataSource: DataSource) {
    super(Message, dataSource.createEntityManager());
  }

  async getMessagesByChatIdQuery(
    chatId: number,
    tenantId: string,
    filter?: MessageFilter,
    entityManager?: EntityManager,
  ): Promise<{ messages: Message[]; count: number }> {
    const repo = entityManager?.getRepository(Message) || this;
    const query = repo
      .createQueryBuilder('message')
      .where('message.chatId = :chatId', { chatId })
      .leftJoinAndMapOne(
        'message.feedback',
        Feedback,
        'feedback',
        'feedback.messageId = message.id',
      );

    const sortColumn = this.getValidatedSortColumn(
      filter?.sortBy || 'createdAt',
    );
    if (sortColumn) {
      query.orderBy(`message.${sortColumn}`, filter?.order || 'DESC');
    }

    if (filter?.type) {
      query.andWhere('message.type = :type', { type: filter.type });
    }
    if (filter?.limit) {
      query.limit(filter.limit);
    }
    if (filter?.offset) {
      query.offset(filter.offset);
    }
    query.andWhere('message.tenantId = :tenantId', { tenantId });

    const [messages, count] = await query.getManyAndCount();
    return { messages, count };
  }

  async getChatHistoryQuery(
    chatId: number,
    tenantId: string,
    pagination?: {
      limit?: number;
      offset?: number;
      sortBy?: string;
      order?: string;
    },
  ): Promise<Message[]> {
    const query = this.createQueryBuilder('message')
      .leftJoinAndMapOne(
        'message.sender',
        User,
        'sender',
        'sender.id = message.senderId',
      )
      .where('message.chatId = :chatId', { chatId })
      .andWhere('message.type = :type', { type: MessageType.TEXT })
      .orderBy('message.createdAt', 'DESC');

    if (pagination) {
      if (pagination.offset) {
        query.offset(pagination.offset);
      }
      if (pagination.limit) {
        query.limit(pagination.limit);
      }
    }

    if (pagination?.sortBy) {
      const sortColumn = this.getValidatedSortColumn(pagination.sortBy);
      if (sortColumn) {
        query.orderBy(
          `message.${sortColumn}`,
          pagination.order as 'ASC' | 'DESC',
        );
      }
    }
    query.andWhere('message.tenantId = :tenantId', { tenantId });

    return query.getMany();
  }

  private getValidatedSortColumn(sortBy?: string): string | null {
    if (!sortBy) {
      return MessageSortBy.CREATED_AT;
    }
    const validColumns = Object.values(MessageSortBy);
    return validColumns.includes(sortBy as MessageSortBy)
      ? sortBy
      : MessageSortBy.CREATED_AT;
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
