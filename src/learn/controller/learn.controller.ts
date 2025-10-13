import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Body,
  Put,
  Delete,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AuthRoles } from 'src/auth/decorators/auth-roles.decorator';
import { UserRole } from 'src/common/constants/user.constants';
import { ScenarioService } from '../service/scenario.service';
import { ScenarioResponse } from '../dto/scenario-response.dto';
import { ScenarioSessionService } from '../service/scenario-session.service';
import { TokenUser } from 'src/auth/type/auth.types';
import { CurrentUser } from 'src/auth/decorators/user.decorator';
import { SortOrder } from 'src/chat/dto/call-log.request.dto';
import { ScenarioSessionSortBy } from '../enum/scenario-session-sort-by.enum';
import { ScenarioSessionResponseDto } from '../dto/scenario-session-response.dto';
import { StartScenarioSessionRequestDto } from '../dto/start-scenario-session-request.dto';
import { AddFeedbackToScenarioSessionRequestDto } from '../dto/add-feedback-to-scenario-session.dto';
import { CreateScenariosDto } from '../dto/create-scenarios.dto';
import { Scenarios } from '../entity/scenarios.entity';
import { UpdateScenarioDto } from '../dto/update-scenario.dto';
import { Public } from 'src/auth/decorators/auth.metadata';
import { CreateScenarioEventsDto } from '../dto/create-scenario-events.dto';
import { DeleteScenarioEventsDto } from '../dto/delete-scenario-events.dto';

@ApiTags('Learn')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/learn')
export class LearnController {
  constructor(
    private readonly scenarioService: ScenarioService,
    private readonly scenarioSessionService: ScenarioSessionService,
  ) {}

  @Public()
  @ApiOperation({ summary: 'Get all scenarios' })
  @Get('scenarios')
  async getScenarios(): Promise<ScenarioResponse[]> {
    return this.scenarioService.getScenarios();
  }

  // TODO: Remove swagger lock
  @Public()
  @ApiOperation({ summary: 'Get a scenario by id' })
  @Get('scenarios/:id')
  async getScenario(@Param('id') id: number): Promise<ScenarioResponse> {
    return this.scenarioService.getScenario(id, [
      'id',
      'title',
      'scenario',
      'description',
      'coverImageUrl',
      'status',
    ]);
  }

  @ApiOperation({ summary: 'Create multiple scenarios' })
  @AuthRoles(UserRole.SUPER_ADMIN)
  @Post('scenarios')
  async createScenario(
    @Body() createScenariosDto: CreateScenariosDto,
  ): Promise<Scenarios[]> {
    return this.scenarioService.createScenarios(createScenariosDto);
  }

  @ApiOperation({ summary: 'Update a scenario by id' })
  @AuthRoles(UserRole.SUPER_ADMIN)
  @Put('scenarios/:id')
  async updateScenario(
    @Param('id') id: number,
    @Body() updateScenarioDto: UpdateScenarioDto,
  ): Promise<boolean> {
    return this.scenarioService.updateScenario(id, updateScenarioDto);
  }

  @ApiOperation({ summary: 'Get all scenario sessions for user' })
  @ApiResponse({
    status: 200,
    description: 'Returns the list of scenario sessions',
    type: ScenarioSessionResponseDto,
    isArray: true,
  })
  @ApiQuery({
    name: 'statuses',
    required: false,
    type: String,
    description: 'Filter by scenario session statuses (comma-separated)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of records to return',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of records to skip',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ScenarioSessionSortBy,
    description: 'Field to sort by',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: SortOrder,
    description: 'Sort order',
  })
  @AuthRoles(UserRole.LEARNER)
  @Get('scenario-sessions')
  async getScenarioSessions(
    @CurrentUser() tokenUser: TokenUser,
    @Query('statuses') statuses?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy')
    sortBy: ScenarioSessionSortBy = ScenarioSessionSortBy.CREATED_AT,
    @Query('order') order: SortOrder = SortOrder.DESC,
  ) {
    return this.scenarioSessionService.getScenarioSessions(
      tokenUser.id,
      {
        limit,
        offset,
        sortBy,
        order,
      },
      statuses,
    );
  }

  @ApiOperation({ summary: 'Get all scenario sessions for admin' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of records to return',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of records to skip',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ScenarioSessionSortBy,
    description: 'Field to sort by',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: SortOrder,
    description: 'Sort order',
  })
  @AuthRoles(UserRole.ADMIN)
  @Get('admin-scenario-sessions')
  async getAdminScenarioSessions(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy')
    sortBy: ScenarioSessionSortBy = ScenarioSessionSortBy.CREATED_AT,
    @Query('order') order: SortOrder = SortOrder.DESC,
  ) {
    return this.scenarioSessionService.getAdminScenarioSessions({
      limit,
      offset,
      sortBy,
      order,
    });
  }

  @ApiOperation({ summary: 'Get a scenario session by id' })
  @AuthRoles(UserRole.LEARNER, UserRole.ADMIN)
  @Get('scenario-session/:id')
  async getScenarioSession(
    @CurrentUser() tokenUser: TokenUser,
    @Param('id') id: string,
  ) {
    return this.scenarioSessionService.getScenarioSession(id, tokenUser.id);
  }

  @ApiOperation({ summary: 'Map events to scenario' })
  @AuthRoles(UserRole.SUPER_ADMIN)
  @Post('scenarios/map-events')
  async mapEventsToScenario(
    @Body() createScenarioEventsDto: CreateScenarioEventsDto,
  ) {
    return this.scenarioSessionService.mapEventsToScenario(
      createScenarioEventsDto,
    );
  }

  @ApiOperation({ summary: 'Delete scenario events' })
  @AuthRoles(UserRole.SUPER_ADMIN)
  @Delete('scenarios/events')
  async deleteScenarioEvents(
    @Body() deleteScenarioEventsDto: DeleteScenarioEventsDto,
  ) {
    const rowsAffected = await this.scenarioSessionService.deleteScenarioEvents(
      deleteScenarioEventsDto,
    );
    return rowsAffected != null && rowsAffected > 0;
  }

  @ApiOperation({ summary: 'Start a scenario session' })
  @AuthRoles(UserRole.LEARNER)
  @Post('scenario-session-start')
  async startScenarioSession(
    @CurrentUser() tokenUser: TokenUser,
    @Body() startScenarioSessionDto: StartScenarioSessionRequestDto,
  ) {
    return this.scenarioSessionService.startScenarioSession(
      tokenUser.id,
      startScenarioSessionDto,
    );
  }

  @ApiOperation({ summary: 'End a scenario session' })
  @AuthRoles(UserRole.LEARNER)
  @Post('scenario-session/:scenarioSessionId/end')
  async endScenarioSession(
    @CurrentUser() tokenUser: TokenUser,
    @Param('scenarioSessionId') scenarioSessionId: string,
  ) {
    return this.scenarioSessionService.endScenarioSession(
      scenarioSessionId,
      tokenUser.id,
    );
  }

  @ApiOperation({ summary: 'Add a feedback to a scenario session' })
  @AuthRoles(UserRole.LEARNER)
  @Post('scenario-session/:scenarioSessionId/feedback')
  async addFeedbackToScenarioSession(
    @CurrentUser() tokenUser: TokenUser,
    @Param('scenarioSessionId') scenarioSessionId: string,
    @Body()
    addFeedbackToScenarioSessionDto: AddFeedbackToScenarioSessionRequestDto,
  ) {
    return this.scenarioSessionService.addFeedbackToScenarioSession(
      scenarioSessionId,
      tokenUser.id,
      addFeedbackToScenarioSessionDto,
    );
  }

  @ApiOperation({ summary: 'Get messages for a scenario session' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of messages to return',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of messages to skip',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    type: String,
    description: 'Field to sort by (default: createdAt)',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: SortOrder,
    description: 'Sort order (default: DESC)',
  })
  @AuthRoles(UserRole.LEARNER, UserRole.ADMIN)
  @Get('scenario-session/:scenarioSessionId/messages')
  async getMessagesByScenarioSessionId(
    @Param('scenarioSessionId') scenarioSessionId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy?: string,
    @Query('order') order: SortOrder = SortOrder.ASC,
  ) {
    return this.scenarioSessionService.getMessagesByScenarioSessionId(
      scenarioSessionId,
      {
        limit,
        offset,
        sortBy,
        order,
      },
    );
  }
}
