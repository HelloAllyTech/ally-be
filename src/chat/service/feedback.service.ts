import { Injectable, NotFoundException } from '@nestjs/common';
import { Feedback } from '../entity/feedback.entity';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { FeedbackRepository } from '../repository/feedback.repository';

@Injectable()
export class FeedbackService {
  constructor(private feedbackRepository: FeedbackRepository) {}

  async create(createFeedbackDto: Partial<Feedback>): Promise<Feedback> {
    return await this.feedbackRepository.createFeedback({
      ...createFeedbackDto,
      tenantId: ExecutionManager.getTenantId(),
    });
  }

  async findByMessageId(messageId: number): Promise<Feedback[]> {
    return await this.feedbackRepository.findByMessageId(
      messageId,
      ExecutionManager.getTenantId()!,
    );
  }

  async update(
    id: number,
    updateFeedbackDto: Partial<Feedback>,
  ): Promise<Feedback> {
    const feedback = await this.feedbackRepository.updateFeedback(
      id,
      updateFeedbackDto,
      ExecutionManager.getTenantId()!,
    );
    if (!feedback) {
      throw new NotFoundException(`Feedback with ID ${id} not found`);
    }
    return feedback;
  }
}
