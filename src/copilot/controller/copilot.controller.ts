import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CopilotService } from '../service/copilot.service';
import {
  CopilotRunDto,
  CreateCopilotRunDto,
  CreateCopilotRunResponseDto,
} from '../dto/copilot.dto';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { TokenUser } from 'src/auth/type/auth.types';

@ApiTags('Copilot')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({ path: 'learn/copilot', version: '1' })
export class CopilotController {
  constructor(private readonly copilotService: CopilotService) {}

  @Post('/runs')
  @ApiOperation({
    summary:
      'Start a Copilot auto-build run: generate a roleplay actor, run a ' +
      'practice conversation + evaluation, and refine until it scores well.',
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @ApiResponse({ status: 201, type: CreateCopilotRunResponseDto })
  async startRun(
    @CurrentUser() tokenUser: TokenUser,
    @Body() dto: CreateCopilotRunDto,
  ): Promise<CreateCopilotRunResponseDto> {
    const { runId, status } = await this.copilotService.startRun(
      dto,
      tokenUser.id,
    );
    return { runId, status };
  }

  @Get('/runs/:runId')
  @ApiOperation({ summary: 'Get a Copilot run (status, rounds, score)' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @ApiResponse({ status: 200, type: CopilotRunDto })
  async getRun(
    @CurrentUser() tokenUser: TokenUser,
    @Param('runId') runId: string,
  ): Promise<CopilotRunDto> {
    return this.copilotService.getRun(runId, tokenUser.id);
  }

  @Post('/runs/:runId/cancel')
  @ApiOperation({ summary: 'Cancel an in-progress Copilot run' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @ApiResponse({ status: 200, type: CopilotRunDto })
  async cancelRun(
    @CurrentUser() tokenUser: TokenUser,
    @Param('runId') runId: string,
  ): Promise<CopilotRunDto> {
    return this.copilotService.cancelRun(runId, tokenUser.id);
  }
}
