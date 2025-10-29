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
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ScenarioService } from '../service/scenario.service';
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
import { ScenarioSortBy } from '../enum/scenario-sort-by.enum';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { CreateScenarioVoiceDto } from '../dto/create-scenario-voice.dto';
import { UpdateScenarioVoiceDto } from '../dto/update-scenario-voice.dto';
import { ScenarioVoiceSortBy } from '../enum/scenario-voice-sort-by.enum';
import { ScenarioImageUploadRequestDto } from '../dto/scenario-image-upload-request.dto';
import { ScenarioImageUploadResponseDto } from '../dto/scenario-image-upload-response.dto';
import { PreviewScenarioDto } from '../dto/preview-scenario.dto';
import { DeleteCoverImageDto } from '../dto/delete-cover-image.dto';

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
  async getScenarios(): Promise<Scenarios[]> {
    return this.scenarioService.getScenarios();
  }

  @ApiOperation({ summary: 'Get all scenarios ' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Number of users to return',
  })
  @ApiQuery({
    name: 'offset',
    required: false,
    type: Number,
    description: 'Number of users to skip',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ScenarioSortBy,
    description: 'Field to sort by',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: SortOrder,
    description: 'Sort order: ASC or DESC',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    type: String,
    description: 'Filter by scenario status(comma-separated)',
  })
  @Get('admin-scenarios')
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_SCENARIOS])
  async getAdminScenarios(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy')
    sortBy: ScenarioSortBy = ScenarioSortBy.CREATED_AT,
    @Query('order') order: SortOrder = SortOrder.ASC,
    @Query('status') status?: string,
  ) {
    return this.scenarioService.getAdminScenarios(status, {
      limit,
      offset,
      sortBy,
      order,
    });
  }

  // TODO: Remove swagger lock
  @Public()
  @ApiOperation({ summary: 'Get a scenario by id' })
  @Get('scenarios/:id')
  async getScenario(@Param('id') id: number): Promise<Scenarios> {
    return this.scenarioService.getScenario(id, [
      'id',
      'title',
      'scenario',
      'description',
      'coverImageUrl',
      'status',
    ]);
  }

  @ApiOperation({ summary: 'Get a scenario by id' })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_SCENARIO])
  @Get('admin-scenarios/:id')
  async getAdminScenario(@Param('id') id: number): Promise<Scenarios> {
    return this.scenarioService.getAdminScenario(id);
  }

  @ApiOperation({ summary: 'Get presigned URL for scenario cover image' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Post('scenarios/cover-image-url')
  async getPresignedUrlForScenarioCoverImage(
    @Body() scenarioImageUploadRequestDto: ScenarioImageUploadRequestDto,
  ): Promise<ScenarioImageUploadResponseDto> {
    return this.scenarioService.getPresignedUrlForScenarioCoverImage(
      scenarioImageUploadRequestDto,
    );
  }

  @ApiOperation({ summary: 'Create multiple scenarios' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Post('scenarios')
  async createScenario(
    @CurrentUser() tokenUser: TokenUser,
    @Body() createScenariosDto: CreateScenariosDto,
  ): Promise<Scenarios[]> {
    return this.scenarioService.createScenarios(
      createScenariosDto,
      tokenUser.id,
    );
  }

  @ApiOperation({ summary: 'Update a scenario by id' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Put('scenarios/:id')
  async updateScenario(
    @CurrentUser() tokenUser: TokenUser,
    @Param('id') id: number,
    @Body() updateScenarioDto: UpdateScenarioDto,
  ): Promise<boolean> {
    return this.scenarioService.updateScenario(
      id,
      updateScenarioDto,
      tokenUser.id,
    );
  }

  @ApiOperation({ summary: 'Preview a scenario' })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_SCENARIO])
  @Post('scenarios/preview')
  async previewScenario(
    @CurrentUser() tokenUser: TokenUser,
    @Body() previewScenarioDto: PreviewScenarioDto,
  ) {
    return this.scenarioSessionService.previewScenario(
      previewScenarioDto,
      tokenUser.id,
    );
  }

  @ApiOperation({ summary: 'End a preview scenario' })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_SCENARIO])
  @Post('scenarios/preview/:roomName/end')
  async endPreviewScenario(@Param('roomName') roomName: string) {
    return this.scenarioSessionService.endPreviewScenario(roomName);
  }

  @ApiOperation({ summary: 'Delete a scenario by id' })
  @AuthPermissions([PERMISSIONS.DELETE_ADMIN_SCENARIO])
  @Delete('admin-scenarios/:id')
  async deleteAdminScenario(@Param('id') id: number): Promise<boolean> {
    return this.scenarioService.deleteAdminScenario(id);
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
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_SESSION])
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
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_SCENARIO_SESSION])
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
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_SESSION_DETAILS])
  @Get('scenario-session/:id')
  async getScenarioSession(
    @CurrentUser() tokenUser: TokenUser,
    @Param('id') id: string,
  ) {
    return this.scenarioSessionService.getScenarioSession(id, tokenUser.id);
  }

  @ApiOperation({ summary: 'Get scenario events' })
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_EVENTS])
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
    type: String,
    description: 'Field to sort by',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: SortOrder,
    description: 'Sort order',
  })
  @Get('scenarios/:id/events')
  async getScenarioEvents(
    @Param('id') id: number,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy?: string,
    @Query('order') order?: 'ASC' | 'DESC',
  ) {
    return this.scenarioService.getScenarioEvents(id, {
      limit,
      offset,
      sortBy: sortBy || 'createdAt',
      order: order || SortOrder.DESC,
    });
  }

  @ApiOperation({ summary: 'Map events to scenario' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_MAP_EVENTS])
  @Post('scenarios/map-events')
  async mapEventsToScenario(
    @Body() createScenarioEventsDto: CreateScenarioEventsDto,
  ) {
    return this.scenarioService.mapEventsToScenario(createScenarioEventsDto);
  }

  @ApiOperation({ summary: 'Delete scenario events' })
  @AuthPermissions([PERMISSIONS.DELETE_SCENARIO_SESSION])
  @Delete('scenarios/events')
  async deleteScenarioEvents(
    @Body() deleteScenarioEventsDto: DeleteScenarioEventsDto,
  ) {
    const rowsAffected = await this.scenarioService.deleteScenarioEvents(
      deleteScenarioEventsDto,
    );
    return rowsAffected != null && rowsAffected > 0;
  }

  @ApiOperation({ summary: 'Start a scenario session' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_SESSION])
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
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_SESSION])
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
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_SESSION_FEEDBACK])
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
  @AuthPermissions([PERMISSIONS.VIEW_SESSION_SCENARIO_MESSAGES])
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

  @ApiOperation({ summary: 'Get all scenario voices' })
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
    enum: ScenarioVoiceSortBy,
    description: 'Field to sort by',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: SortOrder,
    description: 'Sort order',
  })
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_VOICES])
  @Get('scenario-voices')
  async getScenarioVoices(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy?: string,
    @Query('order') order: SortOrder = SortOrder.ASC,
  ) {
    return this.scenarioService.getScenarioVoices({
      limit,
      offset,
      sortBy,
      order,
    });
  }

  @ApiOperation({ summary: 'Create a scenario voice' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_VOICE])
  @Post('scenarios/voices')
  async createScenarioVoice(
    @Body() createScenarioVoiceDto: CreateScenarioVoiceDto,
  ) {
    return this.scenarioService.createScenarioVoice(createScenarioVoiceDto);
  }

  @ApiOperation({ summary: 'Update a scenario voice' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_VOICE])
  @Put('scenarios/voices/:id')
  async updateScenarioVoice(
    @Param('id') id: string,
    @Body() updateScenarioVoiceDto: UpdateScenarioVoiceDto,
  ) {
    return this.scenarioService.updateScenarioVoice(id, updateScenarioVoiceDto);
  }

  @ApiOperation({ summary: 'Delete cover image' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @ApiBody({ type: DeleteCoverImageDto })
  @Delete('cover-image')
  async deleteCoverImage(@Body() deleteCoverImageDto: DeleteCoverImageDto) {
    return this.scenarioService.deleteCoverImage(deleteCoverImageDto);
  }
}
