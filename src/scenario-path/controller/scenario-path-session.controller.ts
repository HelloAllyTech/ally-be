import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ScenarioPathSessionService } from '../service/scenario-path-session.service';
import { ScenarioPathSessionsResponseDto } from '../dto/scenario-path-sessions.dto';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';

@ApiTags('Learn Scenario Paths')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/learn')
export class ScenarioPathSessionController {
  constructor(
    private readonly scenarioPathSessionService: ScenarioPathSessionService,
  ) {}

  @ApiOperation({ summary: 'Get scenario path sessions' })
  @ApiResponse({
    status: 200,
    description: 'Scenario path sessions retrieved successfully',
    type: ScenarioPathSessionsResponseDto,
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of records to skip',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of records to return',
  })
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_PATH])
  @Get('/scenario-paths')
  async getScenarioPathSessions(
    @Query('offset') offset?: number,
    @Query('limit') limit?: number,
  ): Promise<ScenarioPathSessionsResponseDto> {
    return this.scenarioPathSessionService.getScenarioPathSessions({
      offset,
      limit,
    });
  }
}
