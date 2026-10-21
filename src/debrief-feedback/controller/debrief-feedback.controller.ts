import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { DebriefFeedbackService } from '../service/debrief-feedback.service';
import { ExecutionManager } from 'src/common/execution/execution-manager';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CreateDebriefFeedbackDto } from '../dto/create-debrief-feedback.dto';

@ApiTags('Debrief Feedback')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1/scenario-sessions/:sessionId/debrief-feedback')
export class DebriefFeedbackController {
  constructor(private readonly feedbackService: DebriefFeedbackService) {}

  @Post()
  async createFeedback(
    @Param('sessionId') sessionId: string,
    @Body() body: CreateDebriefFeedbackDto,
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
