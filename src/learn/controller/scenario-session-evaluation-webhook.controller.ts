import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiAuthGuard } from 'src/auth/guards/api-auth.guard';
import { ScenarioSessionEvaluationService } from '../service/scenario-session-evaluation.service';
import { UpdateActorEvaluationDto } from '../dto/scenario-session-evaluation.dto';

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
}
