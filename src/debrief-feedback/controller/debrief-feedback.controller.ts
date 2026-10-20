import { Body, Controller, Param, Post } from '@nestjs/common';
import { DebriefFeedbackService } from '../service/debrief-feedback.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';

@Controller('v1/scenario-sessions/:sessionId/debrief-feedback')
export class DebriefFeedbackController {
  constructor(private readonly feedbackService: DebriefFeedbackService) {}

  @Post()
  async createFeedback(
    @Param('sessionId') sessionId: string,
    @Body() body: { rating: 'positive' | 'negative'; comment?: string },
  ) {
    const tenantId = ExecutionManager.getTenantId();
    return this.feedbackService.createFeedback(
      tenantId!,
      sessionId,
      body.rating,
      body.comment,
    );
  }
}
