import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { RequireFeatureToggle } from 'src/auth/decorators/feature-toggle.decorator';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';
import { FeatureToggleKey } from 'src/authorization/constants/admin-feature-toggle.constants';
import { AgentTurnSettingsService } from 'src/llm-agent/runtime/agent-turn-settings.service';
import {
  UpdateValidatedAgentTurnsDto,
  ValidatedAgentTurnsDto,
} from '../dto/validated-agent-turns.dto';

/**
 * The validated-turns kill switches for Course Copilot and the character
 * interview, on the Settings page's AI models tab. Gated as that page is.
 *
 * Its own controller rather than more routes on SettingsController: the
 * switches belong to the agent runtime, and its service is all this needs.
 */
@ApiTags('Settings')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/settings/validated-agent-turns')
export class AgentTurnSettingsController {
  constructor(private readonly settings: AgentTurnSettingsService) {}

  @Get()
  @RequireFeatureToggle(FeatureToggleKey.SETTINGS)
  @ApiOperation({
    summary:
      'Read whether Course Copilot and the character interview run validated turns',
  })
  @ApiResponse({ status: 200, type: ValidatedAgentTurnsDto })
  get(): Promise<ValidatedAgentTurnsDto> {
    return this.settings.get();
  }

  @Patch()
  @RequireFeatureToggle(FeatureToggleKey.SETTINGS)
  @ApiOperation({
    summary:
      'Turn validated turns on or off for Course Copilot or the character interview',
    description:
      "Takes effect on each agent's next turn. Either field left out keeps its current value.",
  })
  @ApiResponse({ status: 200, type: ValidatedAgentTurnsDto })
  update(
    @Body() body: UpdateValidatedAgentTurnsDto,
    @CurrentUser() user: TokenUser,
  ): Promise<ValidatedAgentTurnsDto> {
    return this.settings.update(body, user.id);
  }
}
