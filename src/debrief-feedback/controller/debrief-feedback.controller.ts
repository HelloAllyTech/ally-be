import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
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
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() body: CreateDebriefFeedbackDto,
  ) {
    const tenantId = ExecutionManager.getTenantId();
    const userId = Number(ExecutionManager.getUserId());
    if (!tenantId || !userId) {
      throw new UnauthorizedException('Unauthorized access');
    }
    return this.feedbackService.createFeedback(
      tenantId,
      userId,
      sessionId,
      body.rating,
      body.comment,
    );
  }
}
