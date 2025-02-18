import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Feedback } from '../../common/entities/feedback.entity';

@Injectable()
export class FeedbackService {
  constructor(
    @InjectRepository(Feedback)
    private feedbackRepository: Repository<Feedback>,
  ) {}

  async create(createFeedbackDto: Partial<Feedback>): Promise<Feedback> {
    const feedback = this.feedbackRepository.create(createFeedbackDto);
    return await this.feedbackRepository.save(feedback);
  }

  async findByMessageId(messageId: number): Promise<Feedback[]> {
    return await this.feedbackRepository.find({
      where: { messageId },
    });
  }

  async update(
    id: number,
    updateFeedbackDto: Partial<Feedback>,
  ): Promise<Feedback> {
    const feedback = await this.feedbackRepository.findOne({
      where: { feedbackId: id },
    });
    if (!feedback) {
      throw new NotFoundException(`Feedback with ID ${id} not found`);
    }
    Object.assign(feedback, updateFeedbackDto);
    return await this.feedbackRepository.save(feedback);
  }
}
