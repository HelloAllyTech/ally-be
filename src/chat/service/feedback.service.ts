import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Feedback } from '../../common/entities/feedback.entity';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { TokenUser } from 'src/auth/type/auth.types';
import { number } from 'joi';
import { Chat } from 'src/common/entities/chat.entity';
import { ChatService } from './chat.service';
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
      where: {
        messageId,
        tenantId: ExecutionManager.getTenantId(),
        userId: Number(ExecutionManager.getUserId()),
      },
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
    if (feedback.userId !== Number(ExecutionManager.getUserId())) {
      throw new ForbiddenException(
        'You can only update your own feedback. This feedback was created by another user.',
      );
    }
    Object.assign(feedback, updateFeedbackDto);
    return await this.feedbackRepository.save(feedback);
  }
}
