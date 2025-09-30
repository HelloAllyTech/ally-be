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

  async findByMessageId(
    messageId: number,
    user: TokenUser,
  ): Promise<Feedback[]> {
    return await this.feedbackRepository.find({
      where: {
        messageId,
        tenantId: ExecutionManager.getTenantId(),
        userId: user.id,
      },
    });
  }

  async update(
    id: number,
    updateFeedbackDto: Partial<Feedback>,
    user: TokenUser,
  ): Promise<Feedback> {
    const feedback = await this.feedbackRepository.findOne({
      where: {
        feedbackId: id,
        tenantId: ExecutionManager.getTenantId(),
      },
    });
    if (!feedback) {
      throw new NotFoundException(`Feedback with ID ${id} not found`);
    }
    if (feedback.userId != user.id) {
      throw new ForbiddenException('You are not allowed to update');
    }
    Object.assign(feedback, updateFeedbackDto);
    return await this.feedbackRepository.save(feedback);
  }
}
