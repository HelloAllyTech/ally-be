import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { IsNumber, IsObject, IsOptional } from 'class-validator';
import { ApiAuthGuard } from 'src/auth/guards/api-auth.guard';
import { ScenarioSessionEvaluationService } from '../service/scenario-session-evaluation.service';
import { UpdateActorEvaluationDto } from '../dto/scenario-session-evaluation.dto';
import { ScenarioSessionService } from '../service/scenario-session.service';

class EndV2VSessionDto {
  @ApiProperty({ description: 'Counselor/owner user ID of the session' })
  @IsNumber()
  counselorId!: number;

  @ApiProperty({
    description:
      'Tester-side run metrics ({maxExchanges, exchangesCompleted, ' +
      'utterancesHeard, ttsFailures, endReason}) — persisted to ' +
      'scenario_sessions.metadata.v2vMetrics as the v2v evaluation baseline',
    required: false,
  })
  @IsOptional()
  @IsObject()
  metrics?: Record<string, any>;
}

/**
 * Webhook (API-key only) for ai-learn to deliver the goal-based actor
 * evaluation of a real session. Mirrors the scenario-report webhook.
 */
@Controller({ path: 'learn/scenario-session', version: '1' })
@ApiTags('Scenario Session Evaluation Webhook')
@UseGuards(ApiAuthGuard)
@ApiSecurity('api-key')
export class ScenarioSessionEvaluationWebhookController {
  constructor(
    private readonly evaluationService: ScenarioSessionEvaluationService,
    private readonly scenarioSessionService: ScenarioSessionService,
  ) {}

  @Patch(':id/evaluation')
  @ApiOperation({
    summary:
      'Webhook: store the goal-based actor evaluation for a session (API key only)',
  })
  @ApiResponse({ status: 200, description: 'Actor evaluation stored' })
  async updateEvaluation(
    @Param('id') id: string,
    @Body() body: UpdateActorEvaluationDto,
  ): Promise<{ success: boolean }> {
    await this.evaluationService.applyResult(id, body);
    return { success: true };
  }

  @Post(':id/end-v2v')
  @ApiOperation({
    summary:
      'Webhook: end a V2V test session and trigger summary generation (API key only)',
  })
  @ApiResponse({ status: 200, description: 'Session ended' })
  async endV2VSession(
    @Param('id') id: string,
    @Body() body: EndV2VSessionDto,
  ): Promise<{ success: boolean }> {
    if (body.metrics) {
      await this.scenarioSessionService.recordV2VMetrics(id, body.metrics);
    }
    await this.scenarioSessionService.endScenarioSession(id, body.counselorId);
    // Score the run now rather than leaving it to the 30-minute catch-up. A
    // V2V run always loses the normal end-of-session trigger (see
    // scheduleV2VEvaluation), and for a test harness the score is the result
    // being waited on — a 15-45 minute lag makes an A/B unrunnable in one
    // sitting. Fire-and-forget: ending the session must not depend on it.
    this.evaluationService.scheduleV2VEvaluation(id);
    return { success: true };
  }
}
