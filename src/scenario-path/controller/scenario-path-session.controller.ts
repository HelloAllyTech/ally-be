import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
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
import { GetUpcomingScenarioPathItemResponseDto } from '../dto/get-scenario-path.dto';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { CreateScenarioPathSessionResponseDto } from '../dto/create-scenario-path-item.dto';
import { UPCOMING_SCENARIO_PATH_ITEM_EXAMPLE } from '../constants/scenario-path.constant';

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
  async getUserScenarioPaths(
    @Query('offset') offset?: number,
    @Query('limit') limit?: number,
  ): Promise<ScenarioPathSessionsResponseDto> {
    return this.scenarioPathSessionService.getUserScenarioPaths({
      offset,
      limit,
    });
  }

  @ApiOperation({ summary: 'Get scenario path session by scenario path id' })
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_PATH])
  @Get('/scenario-paths/:id')
  async getUserScenarioPathItems(@Param('id', ParseUUIDPipe) id: string) {
    return this.scenarioPathSessionService.getUserScenarioPathItems(id);
  }

  @ApiOperation({ summary: 'Create Scenario path session for user' })
  @ApiResponse({
    status: 200,
    type: CreateScenarioPathSessionResponseDto,
    example: {
      scenarioPathSessionItemId: '123',
    },
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_PATH])
  @Post('/scenario-paths/:scenarioPathId/create-session')
  async createScenarioPathSession(
    @Param('scenarioPathId', ParseUUIDPipe) scenarioPathId: string,
  ): Promise<CreateScenarioPathSessionResponseDto> {
    return this.scenarioPathSessionService.createUserPathSession(
      scenarioPathId,
    );
  }

  @ApiOperation({ summary: 'Get upcoming scenario' })
  @ApiResponse({
    status: 200,
    description: 'Upcoming scenario path item retrieved successfully',
    type: GetUpcomingScenarioPathItemResponseDto,
    example: UPCOMING_SCENARIO_PATH_ITEM_EXAMPLE,
  })
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_PATH])
  @Get('/scenario-paths/:scenarioSessionId/upcoming-scenario')
  async getUpcomingScenarioPathItem(
    @Param('scenarioSessionId', ParseUUIDPipe)
    scenarioSessionId: string,
  ): Promise<GetUpcomingScenarioPathItemResponseDto | null> {
    const result =
      await this.scenarioPathSessionService.getNextScenarioPathItem(
        scenarioSessionId,
      );
    if (!result?.nextScenarioData?.scenario || !result?.currentPathItem) {
      return null;
    }
    return {
      ...result.nextScenarioData.scenario,
      order: result.nextScenarioData.pathItem?.order,
      scenarioPathSessionItemId: result.nextScenarioSessionItem?.id,
      transitionMessageTitle: result.currentPathItem.messageTitle,
      transitionMessageContent: result.currentPathItem.messageContent,
    };
  }
}
