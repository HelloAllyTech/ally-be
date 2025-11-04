import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Feedback } from '../entity/feedback.entity';
import { ExecutionManager } from '../../common/execution/execution-manager';
@Injectable()
export class FeedbackService {
  constructor(
    @InjectRepository(Feedback)
    private feedbackRepository: Repository<Feedback>,
  ) {}

  async create(createFeedbackDto: Partial<Feedback>): Promise<Feedback> {
    const feedback = this.feedbackRepository.create({
      ...createFeedbackDto,
      tenantId: ExecutionManager.getTenantId(),
    });
    return await this.feedbackRepository.save(feedback);
  }

  async findByMessageId(messageId: number): Promise<Feedback[]> {
    return await this.feedbackRepository.find({
      where: { messageId, tenantId: ExecutionManager.getTenantId() },
    });
  }

  async update(
    id: number,
    updateFeedbackDto: Partial<Feedback>,
  ): Promise<Feedback> {
    const feedback = await this.feedbackRepository.findOne({
      where: { feedbackId: id, tenantId: ExecutionManager.getTenantId() },
    });
    if (!feedback) {
      throw new NotFoundException(`Feedback with ID ${id} not found`);
    }
    Object.assign(feedback, updateFeedbackDto);
    return await this.feedbackRepository.save(feedback);
  }
}
