import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Feedback } from '../entity/feedback.entity';

@Injectable()
export class FeedbackRepository extends Repository<Feedback> {
  constructor(private dataSource: DataSource) {
    super(Feedback, dataSource.createEntityManager());
  }

  async createFeedback(
    data: Partial<Feedback>,
    entityManager?: EntityManager,
  ): Promise<Feedback> {
    const repository = entityManager
      ? entityManager.getRepository(Feedback)
      : this;
    const feedback = repository.create(data);
    return repository.save(feedback);
  }

  async findByMessageId(
    messageId: number,
    tenantId: string,
    entityManager?: EntityManager,
  ): Promise<Feedback[]> {
    const repository = entityManager
      ? entityManager.getRepository(Feedback)
      : this;
    return repository.find({
      where: { messageId, tenantId },
    });
  }

  async findById(
    id: number,
    tenantId: string,
    entityManager?: EntityManager,
  ): Promise<Feedback | null> {
    const repository = entityManager
      ? entityManager.getRepository(Feedback)
      : this;
    return repository.findOne({
      where: { feedbackId: id, tenantId },
    });
  }

  async updateFeedback(
    id: number,
    data: Partial<Feedback>,
    tenantId: string,
    entityManager?: EntityManager,
  ): Promise<Feedback | null> {
    const repository = entityManager
      ? entityManager.getRepository(Feedback)
      : this;

    const feedback = await this.findById(id, tenantId, entityManager);
    if (!feedback) {
      return null;
    }

    Object.assign(feedback, data);
    return repository.save(feedback);
  }

  async deleteFeedbackByChatId(
    chatId: number,
    tenantId: string,
    entityManager?: EntityManager,
  ): Promise<boolean> {
    const repository = entityManager
      ? entityManager.getRepository(Feedback)
      : this;

    // First find all messages for this chat, then delete their feedback
    const result = await repository
      .createQueryBuilder('feedback')
      .innerJoin('messages', 'message', 'message.id = feedback.messageId')
      .where('message.chatId = :chatId', { chatId })
      .andWhere('feedback.tenantId = :tenantId', { tenantId })
      .delete()
      .execute();

    return result.affected !== 0;
  }
}
