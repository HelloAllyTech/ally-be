import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { SummaryFeedback } from '../entity/summary-feedback.entity';

@Injectable()
export class SummaryFeedbackRepository extends Repository<SummaryFeedback> {
  constructor(private dataSource: DataSource) {
    super(SummaryFeedback, dataSource.createEntityManager());
  }

  async createSummaryFeedback(
    chatId: number,
    rating: number,
    feedback?: any,
    entityManager?: EntityManager,
  ): Promise<SummaryFeedback> {
    const summaryFeedbackRepo =
      entityManager?.getRepository(SummaryFeedback) ||
      this.dataSource.getRepository(SummaryFeedback);
    const summaryFeedback = summaryFeedbackRepo.create({
      chatId,
      rating,
      feedback,
    });
    return this.save(summaryFeedback);
  }

  async deleteSummaryFeedbackByChatId(
    chatId: number,
    em?: EntityManager,
  ): Promise<boolean> {
    const summaryFeedbackRepo = em
      ? em.getRepository(SummaryFeedback)
      : this.dataSource.getRepository(SummaryFeedback);

    const result = await summaryFeedbackRepo.delete(chatId);
    return result.affected !== 0;
  }
}
