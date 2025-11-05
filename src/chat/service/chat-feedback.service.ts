import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from '../../logger/logger.service';
import { CallDetailsRepository } from '../repository/call-details.repository';
import { SummaryFeedbackRepository } from '../repository/summary-feedback.repository';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { AddNoteDto, AddNotesResponse } from '../dto/notes.dto';
import { SummaryFeedbackDto } from '../dto/summary-feedback.dto';
import { SummaryFeedbackResponse } from '../dto/call-log.response.dto';
import { CallDetails } from '../entity/call.details.entity';

@Injectable()
export class ChatFeedbackService {
  private readonly logger = LoggerService.getInstance(ChatFeedbackService.name);

  constructor(
    private callDetailsRepository: CallDetailsRepository,
    private summaryFeedbackRepository: SummaryFeedbackRepository,
    private dataSource: DataSource,
  ) {}

  async addNoteToSession(
    chatId: number,
    createNoteDto: AddNoteDto,
  ): Promise<AddNotesResponse> {
    const callDetails = await this.callDetailsRepository.findOne({
      where: { chatId, tenantId: ExecutionManager.getTenantId() },
    });

    if (!callDetails) {
      throw new NotFoundException(`Call details not found for chat ${chatId}`);
    }

    const existingCallInfo = callDetails.callInfo || {};
    const updatedCallInfo = {
      ...existingCallInfo,
      notes: createNoteDto.content,
    };

    await this.callDetailsRepository.update(
      { chatId, tenantId: ExecutionManager.getTenantId() },
      { callInfo: updatedCallInfo },
    );

    return { notes: createNoteDto.content };
  }

  async addFeedbackToChat(
    chatId: number,
    summaryFeedbackDto: SummaryFeedbackDto,
  ): Promise<SummaryFeedbackResponse> {
    return this.dataSource.transaction(async (entityManager) => {
      const callDetailsRepo =
        entityManager.getRepository(CallDetails) || this.callDetailsRepository;
      const summaryFeedbackRepo = this.summaryFeedbackRepository;
      const callDetails = await callDetailsRepo.findOne({
        where: { chatId, tenantId: ExecutionManager.getTenantId() },
      });
      if (!callDetails) {
        this.logger.error(`Call details not found for chat ${chatId}`);
        throw new NotFoundException(
          `Call details not found for chat ${chatId}`,
        );
      }
      const existingCallInfo = callDetails.callInfo || {};
      const updatedCallInfo = {
        ...existingCallInfo,
        isSummaryFeedbackAdded: true,
      };

      const feedback = await summaryFeedbackRepo.createSummaryFeedback(
        chatId,
        summaryFeedbackDto.rating,
        summaryFeedbackDto.feedback,
        entityManager,
      );

      await callDetailsRepo.update(
        { chatId, tenantId: ExecutionManager.getTenantId() },
        { callInfo: updatedCallInfo },
      );
      return { message: 'Feedback added successfully', feedback };
    });
  }
}
