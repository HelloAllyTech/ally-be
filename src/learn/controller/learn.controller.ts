import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Body,
  Put,
  Delete,
  ParseEnumPipe,
  ParseUUIDPipe,
  Version,
  Patch,
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
import { AssignmentStatus, SuccessResponse } from 'src/common/type/common.type';
import { ScenarioSessionSortBy } from '../enum/scenario-session-sort-by.enum';
import { ScenarioSessionResponseDto } from '../dto/scenario-session-response.dto';
import { StartScenarioSessionRequestDto } from '../dto/start-scenario-session-request.dto';
import { AddFeedbackToScenarioSessionRequestDto } from '../dto/add-feedback-to-scenario-session.dto';
import { CreateScenariosDto } from '../dto/create-scenarios.dto';
import { Scenarios } from '../entity/scenarios.entity';
import { UpdateScenarioDto } from '../dto/update-scenario.dto';
import { ScenarioVersionService } from '../service/scenario-version.service';
import { ScenarioVersion } from '../entity/scenario-version.entity';
import { CreateScenarioVersionDto } from '../dto/create-scenario-version.dto';
import { UpdateScenarioVersionDto } from '../dto/update-scenario-version.dto';
import { Public } from 'src/auth/decorators/auth.metadata';
import { CreateScenarioEventsDto } from '../dto/create-scenario-events.dto';
import { DeleteScenarioEventsDto } from '../dto/delete-scenario-events.dto';
import { ScenarioSortBy } from '../type/scenario.type';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import {
  ElevenLabsBulkSyncSummary,
  ElevenLabsVoiceLookupResult,
  ElevenLabsVoiceSyncResult,
  ElevenLabsVoiceSyncService,
} from '../service/elevenlabs-voice-sync.service';
import {
  TtsCatalogEntry,
  TtsCatalogService,
} from '../service/tts-catalog.service';
import { TenantScopedPermissions } from 'src/auth/decorators/own-tenant-scope.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { CreateScenarioVoicesDto } from '../dto/create-scenario-voices.dto';
import {
  CreateProviderConfigDto,
  UpdateProviderConfigDto,
} from '../dto/provider-config.dto';
import { SttConfigService } from '../service/stt-config.service';
import { LlmConfigService } from '../service/llm-config.service';
import { UpdateScenarioVoiceDto } from '../dto/update-scenario-voice.dto';
import { ScenarioVoiceSortBy } from '../enum/scenario-voice-sort-by.enum';
import { ScenarioImageUploadRequestDto } from '../dto/scenario-image-upload-request.dto';
import { ScenarioImageUploadResponseDto } from '../dto/scenario-image-upload-response.dto';
import { PreviewScenarioDto } from '../dto/preview-scenario.dto';
import { DeleteCoverImageDto } from '../dto/delete-cover-image.dto';
import { ScenarioVideoUploadResponseDto } from '../dto/scenario-video-upload-response.dto';
import { ScenarioVideoUploadRequestDto } from '../dto/scenario-video-upload-request.dto';
import { DeleteCoverVideoDto } from '../dto/delete-cover-video.dto';
import {
  GetAdminScenarioDto,
  GetScenarioDtoWithPagination,
} from '../dto/get-scenario.dto';
import { AddScenarioTenantDto } from '../dto/add-scenario-tenant.dto';
import { ScenarioTenantService } from '../service/scenario-tenant.service';
import { DeleteScenarioTenantDto } from '../dto/delete-scenario-tenant.dto';
import { ScenarioSessions } from '../entity/scenario-sessions.entity';
import { SCENARIO_SESSION_EXAMPLE } from '../constants/scenario-session.constants';
import { CreateTriggerWarningDto } from '../dto/trigger-warning.dto';
import { TriggerWarningsService } from '../service/trigger-warnings.service';
import { TriggerWarnings } from '../entity/trigger-warnings.entity';
import { GetScenarioResponse } from '../interface/session.interface';
import {
  AvailableLanguage,
  ScenarioVoiceLanguage,
} from '../type/scenario-language-voice.type';
import { TriggerWarningsSortBy } from '../enum/trigger-warnings-sort-by.enum';
import { ScenarioSessionSkillsResponseDto } from '../dto/scenario-session-skills-response.dto';
import { ScenarioSessionEventChecklistResponseDto } from '../dto/scenario-session-event-checklist-response.dto';
import { ScenarioSessionReflectionPromptsResponseDto } from '../dto/scenario-session-reflection-prompts-response.dto';
import { UpdateReflectionPromptResponseDto } from '../dto/reflection-prompts-request.dto';
import {
  EnhanceScenarioFieldDto,
  EnhanceScenarioFieldResponseDto,
} from '../dto/enhance-scenario-field.dto';
import {
  GenerateAgentBuilderFieldDto,
  GenerateAgentBuilderFieldResponseDto,
} from '../dto/generate-agent-builder-field.dto';
import { EndScenarioSessionRequestBodyDto } from '../dto/end-scenario-session-request-body.dto';
import { StartV2VTestSessionDto } from '../dto/start-v2v-test-session.dto';
import { AuthRoles } from 'src/auth/decorators/auth-roles.decorator';
import { SUPER_ADMIN_ROLES } from 'src/common/constants/user.constants';

@ApiTags('Learn')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller({
  path: 'learn',
  version: '1',
})
export class LearnController {
  constructor(
    private readonly elevenLabsVoiceSyncService: ElevenLabsVoiceSyncService,
    private readonly ttsCatalogService: TtsCatalogService,
    private readonly scenarioService: ScenarioService,
    private readonly scenarioSessionService: ScenarioSessionService,
    private readonly scenarioTenantService: ScenarioTenantService,
    private readonly triggerWarningService: TriggerWarningsService,
    private readonly scenarioVersionService: ScenarioVersionService,
    private readonly sttConfigService: SttConfigService,
    private readonly llmConfigService: LlmConfigService,
  ) {}

  @Public()
  @ApiOperation({ summary: 'Get all scenarios' })
  @Get('scenarios')
  async getScenarios(): Promise<Scenarios[]> {
    return this.scenarioService.getScenarios();
  }

  @Public()
  @ApiOperation({ summary: 'Get all public scenarios' })
  @Get('scenarios/public')
  async getPublicScenarios(): Promise<GetScenarioDtoWithPagination> {
    return this.scenarioService.getPublicScenarios();
  }

  @ApiOperation({ summary: 'Get all scenarios' })
  @Version('2')
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIOS])
  @Get('scenarios')
  async getPublicScenariosV2(
    @Query('languageCode') languageCode?: string,
  ): Promise<GetScenarioDtoWithPagination> {
    return this.scenarioService.getScenariosV2(languageCode);
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
  @ApiQuery({
    name: 'tenantId',
    required: false,
    type: String,
    description: 'TenantId',
  })
  @ApiQuery({
    name: 'assignmentStatus',
    required: false,
    enum: AssignmentStatus,
    description:
      'Filter by tenant assignment status (requires tenantId; ignored without it)',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by title',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    type: String,
    description: 'Filter by scenario category (comma-separated)',
  })
  @ApiQuery({
    name: 'partnerOrgName',
    required: false,
    type: String,
    description: 'Filter by partner organisation tag (substring match)',
  })
  @Get('admin-scenarios')
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_SCENARIOS])
  async getAdminScenarios(
    @CurrentUser() tokenUser: TokenUser,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy')
    sortBy: ScenarioSortBy = ScenarioSortBy.CREATED_AT,
    @Query('order') order: SortOrder = SortOrder.ASC,
    @Query('status') status?: string,
    @Query('tenantId', new ParseUUIDPipe({ optional: true })) tenantId?: string,
    @Query(
      'assignmentStatus',
      new ParseEnumPipe(AssignmentStatus, { optional: true }),
    )
    assignmentStatus?: AssignmentStatus,
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('partnerOrgName') partnerOrgName?: string,
  ) {
    return this.scenarioService.getAdminScenarios(
      { status, category, partnerOrgName, tenantId, assignmentStatus, search },
      {
        limit,
        offset,
        sortBy,
        order,
      },
      tokenUser,
    );
  }

  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO])
  @ApiOperation({ summary: 'Get a scenario by id' })
  @Get('scenarios/:id')
  async getScenario(
    @Param('id') id: number,
    @Query('languageCode') languageCode?: string,
  ): Promise<GetScenarioResponse> {
    return this.scenarioService.getScenario(
      id,
      {
        select: [
          'id',
          'title',
          'scenario',
          'description',
          'coverImageUrl',
          'coverVideoUrl',
          'status',
        ],
      },
      languageCode,
    );
  }

  @Public()
  @ApiOperation({ summary: 'Get a scenario by id' })
  @Get('scenarios/:id/public')
  async getPublicScenario(
    @Param('id') id: number,
  ): Promise<GetScenarioResponse> {
    return this.scenarioService.getScenario(id, {
      select: [
        'id',
        'title',
        'scenario',
        'description',
        'coverImageUrl',
        'coverVideoUrl',
        'status',
      ],
      isPublic: true,
    });
  }

  @ApiOperation({ summary: 'Get a scenario by id' })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_SCENARIO])
  @ApiResponse({
    status: 200,
    description: 'Returns the scenario',
    type: GetAdminScenarioDto,
  })
  @Get('admin-scenarios/:id')
  async getAdminScenario(
    @CurrentUser() tokenUser: TokenUser,
    @Param('id') id: number,
  ): Promise<GetAdminScenarioDto> {
    return this.scenarioService.getAdminScenario(id, tokenUser);
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

  @ApiOperation({ summary: 'Get presigned URL for scenario cover video' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Post('scenarios/cover-video-url')
  async getPresignedUrlForScenarioCoverVideo(
    @Body() scenarioVideoUploadRequestDto: ScenarioVideoUploadRequestDto,
  ): Promise<ScenarioVideoUploadResponseDto> {
    return this.scenarioService.getPresignedUrlForScenarioCoverVideo(
      scenarioVideoUploadRequestDto,
    );
  }

  @ApiOperation({ summary: 'Delete cover video' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @ApiBody({ type: DeleteCoverVideoDto })
  @Delete('cover-video')
  async deleteCoverVideo(@Body() deleteCoverVideoDto: DeleteCoverVideoDto) {
    return this.scenarioService.deleteCoverVideo(deleteCoverVideoDto);
  }

  @ApiOperation({ summary: 'Get available models for autofill' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Get('models')
  async getAvailableModels(): Promise<
    {
      value: string;
      label: string;
      provider: string;
      supportsTemperature: boolean;
    }[]
  > {
    return this.scenarioService.getAvailableModels();
  }

  @ApiOperation({
    summary:
      'Enhance the existing content of a scenario field using AI (preset or custom guidance)',
  })
  @ApiResponse({
    status: 200,
    description: 'Enhanced field content',
    type: EnhanceScenarioFieldResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Post('scenarios/enhance-field')
  async enhanceScenarioField(
    @Body() enhanceScenarioFieldDto: EnhanceScenarioFieldDto,
  ): Promise<EnhanceScenarioFieldResponseDto> {
    return this.scenarioService.enhanceField(enhanceScenarioFieldDto);
  }

  @ApiOperation({
    summary:
      'Agent Builder Copilot: generate one Basic Settings field from the ' +
      'actor brief + competency + agent test cases (fired in parallel per field)',
  })
  @ApiResponse({
    status: 200,
    description: 'Generated field value',
    type: GenerateAgentBuilderFieldResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Post('agent-builder/generate-field')
  async generateAgentBuilderField(
    @Body() dto: GenerateAgentBuilderFieldDto,
  ): Promise<GenerateAgentBuilderFieldResponseDto> {
    return this.scenarioService.generateAgentBuilderField(dto);
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

  @ApiOperation({ summary: 'Duplicate scenario' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Post('scenarios/:id/duplicate')
  async duplicateScenario(@Param('id') id: number): Promise<Scenarios> {
    return this.scenarioService.duplicateScenario(id);
  }

  @ApiOperation({ summary: 'List saved versions of a scenario (newest first)' })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_SCENARIO])
  @Get('scenarios/:id/versions')
  async listScenarioVersions(
    @Param('id') id: number,
  ): Promise<ScenarioVersion[]> {
    return this.scenarioVersionService.listVersions(id);
  }

  @ApiOperation({ summary: 'Get a single scenario version' })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_SCENARIO])
  @Get('scenarios/:id/versions/:versionId')
  async getScenarioVersion(
    @Param('id') id: number,
    @Param('versionId') versionId: string,
  ): Promise<ScenarioVersion> {
    return this.scenarioVersionService.getVersion(id, versionId);
  }

  @ApiOperation({
    summary: 'Create a new draft version (optionally branched from another)',
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Post('scenarios/:id/versions')
  async createScenarioVersion(
    @CurrentUser() tokenUser: TokenUser,
    @Param('id') id: number,
    @Body() createScenarioVersionDto: CreateScenarioVersionDto,
  ): Promise<ScenarioVersion> {
    return this.scenarioVersionService.createVersion(
      id,
      createScenarioVersionDto,
      tokenUser.id,
    );
  }

  @ApiOperation({ summary: 'Autosave a draft version (config and/or name)' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Put('scenarios/:id/versions/:versionId')
  async updateScenarioVersion(
    @CurrentUser() tokenUser: TokenUser,
    @Param('id') id: number,
    @Param('versionId') versionId: string,
    @Body() updateScenarioVersionDto: UpdateScenarioVersionDto,
  ): Promise<ScenarioVersion> {
    return this.scenarioVersionService.updateVersion(
      id,
      versionId,
      updateScenarioVersionDto,
      tokenUser.id,
    );
  }

  @ApiOperation({ summary: 'Publish a version (make it the live scenario)' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Post('scenarios/:id/versions/:versionId/publish')
  async publishScenarioVersion(
    @CurrentUser() tokenUser: TokenUser,
    @Param('id') id: number,
    @Param('versionId') versionId: string,
  ): Promise<ScenarioVersion> {
    return this.scenarioVersionService.publishVersion(
      id,
      versionId,
      tokenUser.id,
    );
  }

  @ApiOperation({ summary: 'Delete a draft version' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Delete('scenarios/:id/versions/:versionId')
  async deleteScenarioVersion(
    @CurrentUser() tokenUser: TokenUser,
    @Param('id') id: number,
    @Param('versionId') versionId: string,
  ): Promise<boolean> {
    return this.scenarioVersionService.deleteVersion(
      id,
      versionId,
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

  @ApiOperation({
    summary: 'Dispatch agent to preview room (local dev only)',
    description:
      'When webhook is unreachable (e.g. localhost), frontend triggers agent dispatch after connecting.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['roomName'],
      properties: { roomName: { type: 'string' } },
    },
  })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_SCENARIO])
  @Post('scenarios/preview/dispatch-agent')
  async dispatchPreviewAgent(@Body('roomName') roomName: string) {
    return this.scenarioSessionService.dispatchPreviewAgent(roomName);
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
  @ApiQuery({
    name: 'languageCode',
    required: false,
    type: String,
    description: 'Filter by language code',
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
    @Query('languageCode') languageCode?: string,
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
      languageCode,
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
  @ApiQuery({
    name: 'languageCode',
    required: false,
    type: String,
    description: 'Filter by language code',
  })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_SCENARIO_SESSION])
  @Get('admin-scenario-sessions')
  async getAdminScenarioSessions(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy')
    sortBy: ScenarioSessionSortBy = ScenarioSessionSortBy.CREATED_AT,
    @Query('order') order: SortOrder = SortOrder.DESC,
    @Query('languageCode') languageCode?: string,
  ) {
    return this.scenarioSessionService.getAdminScenarioSessions(
      {
        limit,
        offset,
        sortBy,
        order,
      },
      languageCode,
    );
  }

  @ApiQuery({
    name: 'enableRecommendations',
    required: false,
    type: Boolean,
    description: 'Enable recommendations',
  })
  @ApiQuery({
    name: 'languageCode',
    required: false,
    type: String,
    description: 'Language code',
  })
  @ApiOperation({ summary: 'Get a scenario session by id' })
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_SESSION_DETAILS])
  @Get('scenario-session/:id')
  async getScenarioSession(
    @CurrentUser() tokenUser: TokenUser,
    @Param('id') id: string,
    @Query('enableRecommendations') enableRecommendations?: boolean,
    @Query('languageCode') languageCode?: string,
  ) {
    return this.scenarioSessionService.getScenarioSession(
      id,
      tokenUser.id,
      enableRecommendations,
      languageCode,
    );
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

  @ApiOperation({
    summary: 'Re-translate every checklist item across all scenarios',
    description:
      'Processes checklist-visible scenario events in pages so a large ' +
      'dataset never gets loaded into memory or a single request at once.',
  })
  @ApiQuery({
    name: 'batchSize',
    required: false,
    type: Number,
    description: 'Rows processed per page (default 50)',
  })
  // Role-gated (not EDIT_SCENARIO_MAP_EVENTS) so multi-tenant admins cannot
  // trigger this operational, all-scenarios bulk operation.
  @AuthRoles(...SUPER_ADMIN_ROLES)
  @Post('scenarios/checklist-items/translate')
  async translateChecklistItems(
    @Query('batchSize') batchSize?: number,
  ): Promise<
    SuccessResponse & {
      processedScenarioEvents: number;
      processedSessionEvents: number;
    }
  > {
    return this.scenarioService.translateChecklistItems(
      batchSize ? Number(batchSize) : undefined,
    );
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

  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        enableRecommendations: { type: 'boolean' },
        languageCode: { type: 'string' },
      },
    },
    required: false,
  })
  @ApiOperation({ summary: 'End a scenario session' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_SESSION])
  @Post('scenario-session/:scenarioSessionId/end')
  async endScenarioSession(
    @CurrentUser() tokenUser: TokenUser,
    @Param('scenarioSessionId') scenarioSessionId: string,
    @Body() endScenarioSessionRequestBodyDto?: EndScenarioSessionRequestBodyDto,
  ) {
    return this.scenarioSessionService.endScenarioSession(
      scenarioSessionId,
      tokenUser.id,
      endScenarioSessionRequestBodyDto,
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
  @ApiQuery({
    name: 'includeTags',
    required: false,
    type: Boolean,
    description: 'When true, include message tags in the response',
  })
  @ApiQuery({
    name: 'languageCode',
    required: false,
    type: String,
    description:
      "When provided and different from the session's source language, returns translated message content. Omit to get the raw source text.",
  })
  @AuthPermissions([PERMISSIONS.VIEW_SESSION_SCENARIO_MESSAGES])
  @Get('scenario-session/:scenarioSessionId/messages')
  async getMessagesByScenarioSessionId(
    @Param('scenarioSessionId') scenarioSessionId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy?: string,
    @Query('order') order: SortOrder = SortOrder.ASC,
    @Query('includeTags') includeTags?: boolean,
    @Query('languageCode') languageCode?: string,
  ) {
    return this.scenarioSessionService.getMessagesByScenarioSessionId(
      scenarioSessionId,
      {
        limit,
        offset,
        sortBy,
        order,
      },
      { includeTags: !!includeTags },
      languageCode,
    );
  }

  @ApiOperation({
    summary: 'Get skills and emotional movements for a scenario session',
  })
  @ApiResponse({
    status: 200,
    description: 'Skills and emotional movements from scenario session details',
    type: ScenarioSessionSkillsResponseDto,
  })
  @AuthPermissions([PERMISSIONS.VIEW_SESSION_SCENARIO_SUMMARY])
  @Get('scenario-session/:scenarioSessionId/skills')
  async getScenarioSessionSkills(
    @Param('scenarioSessionId', ParseUUIDPipe)
    scenarioSessionId: string,
  ): Promise<ScenarioSessionSkillsResponseDto> {
    return this.scenarioSessionService.getScenarioSessionSkills(
      scenarioSessionId,
    );
  }

  @ApiOperation({ summary: 'Get event checklist for a scenario session' })
  @ApiResponse({
    status: 200,
    description: 'Event checklist for a scenario session',
    type: ScenarioSessionEventChecklistResponseDto,
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
    type: String,
    description: 'Field to sort by',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: SortOrder,
    description: 'Sort order',
  })
  @ApiQuery({
    name: 'languageCode',
    required: false,
    type: String,
    description: 'Language code',
  })
  @AuthPermissions([PERMISSIONS.VIEW_SESSION_SCENARIO_SUMMARY])
  @Get('scenario-session/:scenarioSessionId/event-checklist')
  async getScenarioSessionEventChecklist(
    @Param('scenarioSessionId', ParseUUIDPipe) scenarioSessionId: string,
    @CurrentUser() tokenUser: TokenUser,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy?: string,
    @Query('order') order?: SortOrder,
    @Query('languageCode') languageCode?: string,
  ): Promise<ScenarioSessionEventChecklistResponseDto> {
    return this.scenarioSessionService.getScenarioSessionEventChecklist(
      scenarioSessionId,
      tokenUser.id,
      {
        limit,
        offset,
        sortBy,
        order,
      },
      languageCode,
    );
  }

  @ApiOperation({
    summary:
      'Get reflection prompts and saved responses for a scenario session',
  })
  @ApiResponse({
    status: 200,
    description: 'Reflection prompts with optional saved responses',
    type: ScenarioSessionReflectionPromptsResponseDto,
  })
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_SESSION_DETAILS])
  @Get('scenario-session/:scenarioSessionId/reflection-prompts')
  async getReflectionPrompts(
    @Param('scenarioSessionId', ParseUUIDPipe) scenarioSessionId: string,
  ): Promise<ScenarioSessionReflectionPromptsResponseDto> {
    return this.scenarioSessionService.getReflectionPrompts(scenarioSessionId);
  }

  @ApiOperation({
    summary: 'Update a single reflection prompt response',
  })
  @ApiResponse({
    status: 200,
    description: 'Updated reflection prompt response',
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_SESSION])
  @Patch(
    'scenario-session/:scenarioSessionId/reflection-prompts/:reflectionPromptId',
  )
  async updateReflectionPromptResponse(
    @Param('scenarioSessionId', ParseUUIDPipe) scenarioSessionId: string,
    @Param('reflectionPromptId', ParseUUIDPipe) reflectionPromptId: string,
    @Body() updateReflectionPrompt: UpdateReflectionPromptResponseDto,
  ) {
    return this.scenarioSessionService.updateReflectionPromptResponse(
      scenarioSessionId,
      reflectionPromptId,
      updateReflectionPrompt,
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
  @ApiQuery({
    name: 'searchName',
    required: false,
    type: String,
    description: 'Search by voice name',
  })
  @ApiQuery({
    name: 'providers',
    required: false,
    type: String,
    description: 'Filter by providers (comma-separated)',
  })
  @ApiQuery({
    name: 'languageIds',
    required: false,
    type: String,
    description: 'Filter by languageIds (comma-separated)',
  })
  @ApiQuery({
    name: 'genders',
    required: false,
    type: String,
    description:
      "Filter by config gender (comma-separated). Use 'unset' to find voices " +
      'with no gender — those drop their language out of simulation creation.',
  })
  @ApiOperation({
    summary:
      "Pull an ElevenLabs voice's creation type (IVC/PVC/Voice Design) so v3 compatibility is visible",
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_VOICE])
  @Post('scenario-voices/:id/sync-elevenlabs')
  async syncElevenLabsVoice(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ElevenLabsVoiceSyncResult> {
    return this.elevenLabsVoiceSyncService.syncVoice(id);
  }

  @ApiOperation({
    summary:
      "Look up an ElevenLabs voice id before it's saved — resolves its creation type, gender, and language",
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_VOICE])
  @Get('scenario-voices/elevenlabs-lookup')
  async lookupElevenLabsVoice(
    @Query('voiceId') voiceId: string,
  ): Promise<ElevenLabsVoiceLookupResult> {
    return this.elevenLabsVoiceSyncService.lookupVoice(voiceId);
  }

  @ApiOperation({
    summary:
      "Sync every ElevenLabs scenario voice's creation type from the workspace listing",
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_VOICE])
  @Post('scenario-voices/sync-elevenlabs/bulk')
  async bulkSyncElevenLabsVoices(): Promise<ElevenLabsBulkSyncSummary> {
    return this.elevenLabsVoiceSyncService.bulkSyncAllVoices();
  }

  @ApiOperation({
    summary:
      "A TTS provider's account-wide model/voice catalog, annotated for one voice when `voiceId` is given",
  })
  @ApiQuery({ name: 'provider', required: true })
  @ApiQuery({ name: 'languageCode', required: false })
  @ApiQuery({ name: 'voiceProvider', required: false })
  @ApiQuery({
    name: 'voiceId',
    required: false,
    description:
      "ElevenLabs only. Returns the same catalog with each model marked recommended for THIS voice, so a picker can show the verdict without the admin first triggering a sync. Falls back to the plain catalog if the voice can't be read.",
  })
  @ApiQuery({
    name: 'field',
    required: false,
    description:
      "Which config field the options are for, when a provider populates more than one. ElevenLabs takes `voice_id` for every voice in the workspace; omit it for that provider's model list, which is the default. No other provider has a second field.",
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_VOICE])
  @Get('scenario-voices/tts-catalog')
  async getTtsCatalog(
    @Query('provider') provider: string,
    @Query('languageCode') languageCode?: string,
    @Query('voiceProvider') voiceProvider?: string,
    @Query('voiceId') voiceId?: string,
    @Query('field') field?: string,
  ): Promise<TtsCatalogEntry[]> {
    return this.ttsCatalogService.getCatalog({
      provider,
      languageCode,
      voiceProvider,
      voiceId,
      field,
    });
  }

  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_VOICES])
  @Get('scenario-voices')
  async getScenarioVoices(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy?: string,
    @Query('order') order: SortOrder = SortOrder.ASC,
    @Query('searchName') searchName?: string,
    @Query('providers') providers?: string,
    @Query('languageIds') languageIds?: string,
    @Query('genders') genders?: string,
  ) {
    return this.scenarioService.getScenarioVoices(
      searchName,
      providers,
      languageIds,
      {
        limit,
        offset,
        sortBy,
        order,
      },
      genders,
    );
  }

  @ApiOperation({ summary: 'Create scenario voices' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_VOICE])
  @Post(['scenario-voices', 'scenarios/voices'])
  async createScenarioVoices(
    @Body() createScenarioVoicesDto: CreateScenarioVoicesDto,
  ) {
    return this.scenarioService.createScenarioVoices(createScenarioVoicesDto);
  }

  @ApiOperation({ summary: 'Update a scenario voice' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_VOICE])
  @Put(['scenario-voices/:id', 'scenarios/voices/:id'])
  async updateScenarioVoice(
    @Param('id') id: string,
    @Body() updateScenarioVoiceDto: UpdateScenarioVoiceDto,
  ) {
    return this.scenarioService.updateScenarioVoice(id, updateScenarioVoiceDto);
  }

  // The STT registry is language-platform configuration, so it reuses the
  // language permissions rather than introducing a permission nobody has been
  // granted yet.
  @ApiOperation({
    summary: 'List STT configs',
    description:
      'Named speech-to-text configurations. Pass activeOnly=true for pickers, which must not offer retired configs.',
  })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_LANGUAGES])
  @Get('stt-configs')
  async getSttConfigs(@Query('activeOnly') activeOnly?: string) {
    return this.sttConfigService.getConfigs(activeOnly === 'true');
  }

  @ApiOperation({ summary: 'Create an STT config' })
  @AuthPermissions([PERMISSIONS.EDIT_LANGUAGE])
  @Post('stt-configs')
  async createSttConfig(@Body() createConfigDto: CreateProviderConfigDto) {
    return this.sttConfigService.createConfig(createConfigDto);
  }

  @ApiOperation({ summary: 'Update an STT config' })
  @AuthPermissions([PERMISSIONS.EDIT_LANGUAGE])
  @Put('stt-configs/:id')
  async updateSttConfig(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateConfigDto: UpdateProviderConfigDto,
  ) {
    return this.sttConfigService.updateConfig(id, updateConfigDto);
  }

  @ApiOperation({
    summary: 'Delete an STT config',
    description:
      'Refused while a language still defaults to it — deactivate instead.',
  })
  @AuthPermissions([PERMISSIONS.EDIT_LANGUAGE])
  @Delete('stt-configs/:id')
  async deleteSttConfig(@Param('id', ParseUUIDPipe) id: string) {
    return this.sttConfigService.deleteConfig(id);
  }

  // Same gating rationale as the STT registry: language-platform configuration.
  @ApiOperation({
    summary: 'List LLM configs',
    description:
      'Named large-language-model configurations. Pass activeOnly=true for pickers, which must not offer retired configs.',
  })
  @ApiQuery({ name: 'activeOnly', required: false, type: Boolean })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_LANGUAGES])
  @Get('llm-configs')
  async getLlmConfigs(@Query('activeOnly') activeOnly?: string) {
    return this.llmConfigService.getConfigs(activeOnly === 'true');
  }

  @ApiOperation({ summary: 'Create an LLM config' })
  @AuthPermissions([PERMISSIONS.EDIT_LANGUAGE])
  @Post('llm-configs')
  async createLlmConfig(@Body() createLlmDto: CreateProviderConfigDto) {
    return this.llmConfigService.createConfig(createLlmDto);
  }

  @ApiOperation({ summary: 'Update an LLM config' })
  @AuthPermissions([PERMISSIONS.EDIT_LANGUAGE])
  @Put('llm-configs/:id')
  async updateLlmConfig(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateLlmDto: UpdateProviderConfigDto,
  ) {
    return this.llmConfigService.updateConfig(id, updateLlmDto);
  }

  @ApiOperation({
    summary: 'Delete an LLM config',
    description:
      'Refused while a language still defaults to it — deactivate instead.',
  })
  @AuthPermissions([PERMISSIONS.EDIT_LANGUAGE])
  @Delete('llm-configs/:id')
  async deleteLlmConfig(@Param('id', ParseUUIDPipe) id: string) {
    return this.llmConfigService.deleteConfig(id);
  }

  @ApiOperation({ summary: 'Delete cover image' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @ApiBody({ type: DeleteCoverImageDto })
  @Delete('cover-image')
  async deleteCoverImage(@Body() deleteCoverImageDto: DeleteCoverImageDto) {
    return this.scenarioService.deleteCoverImage(deleteCoverImageDto);
  }

  @ApiOperation({ description: 'Assign scenarios to a tenant' })
  @ApiResponse({
    description: 'Scenarios assigned to tenant successfully',
  })
  @TenantScopedPermissions([PERMISSIONS.EDIT_SCENARIO_TENANT])
  @Post('scenario/tenant/:tenantId')
  async assignScenariosToTenant(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() addScenarioTenantDto: AddScenarioTenantDto,
  ) {
    return this.scenarioTenantService.assignScenariosToTenant(
      tenantId,
      addScenarioTenantDto,
    );
  }

  @ApiOperation({ description: 'Remove scenario from tenants' })
  @ApiResponse({
    description: 'Scenario access removed from tenants successfully',
  })
  @TenantScopedPermissions([PERMISSIONS.DELETE_SCENARIO_TENANT])
  @Delete('scenario/tenant/:tenantId')
  async removeScenariosFromTenant(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() deleteScenarioTenantDto: DeleteScenarioTenantDto,
  ) {
    return this.scenarioTenantService.removeScenariosFromTenant(
      tenantId,
      deleteScenarioTenantDto,
    );
  }

  @ApiOperation({
    description: 'get scenario session from path session item id',
  })
  @ApiResponse({
    description: 'Scenario session retrieved successfully',
    type: ScenarioSessions,
    example: SCENARIO_SESSION_EXAMPLE,
  })
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_PATH])
  @Get('scenario-session/scenario-path-session-item/:pathSessionItemId')
  async getLatestScenarioSessionByPathSessionItemId(
    @Param('pathSessionItemId', ParseUUIDPipe) pathSessionItemId: string,
  ): Promise<ScenarioSessions | null> {
    return this.scenarioSessionService.getLatestScenarioSessionByScenarioPathSessionItemId(
      pathSessionItemId,
    );
  }

  @ApiOperation({ description: 'Get case session from case item id' })
  @ApiResponse({
    description: 'Case session retrieved successfully',
    type: ScenarioSessions,
    example: SCENARIO_SESSION_EXAMPLE,
  })
  @AuthPermissions([PERMISSIONS.VIEW_CASE])
  @Get('scenario-session/case-session-item/:caseSessionItemId')
  async getLatestScenarioSessionByCaseSessionItemId(
    @Param('caseSessionItemId', ParseUUIDPipe) caseSessionItemId: string,
  ): Promise<ScenarioSessions | null> {
    return this.scenarioSessionService.getTopScoredScenarioSessionByCaseSessionItemId(
      caseSessionItemId,
    );
  }

  @ApiOperation({ summary: 'Create a trigger warning' })
  @ApiResponse({
    description: 'Trigger warning created successfully',
    type: TriggerWarnings,
    example: {
      name: 'Domestic abuse',
    },
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Post('trigger-warnings')
  async createTriggerWarning(
    @Body() createTriggerWarningDto: CreateTriggerWarningDto,
  ) {
    return this.triggerWarningService.createTriggerWarning(
      createTriggerWarningDto,
    );
  }

  @ApiOperation({
    summary: 'Get trigger warnings based on name filter and add pagination',
  })
  @ApiQuery({
    name: 'name',
    required: false,
    type: String,
    description: 'Name of the trigger warning',
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
    enum: TriggerWarningsSortBy,
    description: 'Field to sort by',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: SortOrder,
    description: 'Sort order',
  })
  @ApiResponse({
    description: 'Trigger warnings retrieved successfully',
    type: TriggerWarnings,
    isArray: true,
  })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Get('trigger-warnings')
  async getTriggerWarnings(
    @Query('name') name?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy?: TriggerWarningsSortBy,
    @Query('order') order?: SortOrder,
  ) {
    return this.triggerWarningService.getTriggerWarnings(name, {
      limit,
      offset,
      sortBy,
      order,
    });
  }

  @ApiQuery({
    name: 'active',
    required: false,
    type: Boolean,
    description: 'Filter by active ',
  })
  @ApiQuery({
    name: 'voiceNeeded',
    required: false,
    type: Boolean,
    description: 'Filter by voice needed',
  })
  @Get('scenario-voice-languages')
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_SCENARIO_VOICE_LANGUAGES])
  async getScenarioVoiceLanguagesForAdmin(
    @Query('active') active?: boolean,
    @Query('voicesNeeded') voicesNeeded?: boolean,
  ): Promise<ScenarioVoiceLanguage[]> {
    return this.scenarioService.getScenarioVoiceLanguagesForAdmin(
      active,
      voicesNeeded,
    );
  }

  @ApiOperation({ summary: 'Get languages for scenario' })
  @ApiQuery({
    name: 'active',
    required: false,
    type: Boolean,
    description: 'Filter by active ',
  })
  @ApiQuery({
    name: 'hasVoices',
    required: false,
    type: Boolean,
    description: 'Filter by has voices',
  })
  @Get('scenario-languages')
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_LANGUAGES])
  async getLanguagesForScenario(
    @Query('active') active?: boolean,
    @Query('hasVoices') hasVoices?: boolean,
  ): Promise<AvailableLanguage[]> {
    return this.scenarioService.getLanguagesForScenario(active, hasVoices);
  }

  @ApiOperation({ summary: 'Get dynamic branch shortcuts' })
  @ApiQuery({
    name: 'scenarioId',
    required: false,
    type: Number,
    description: 'Scenario ID',
  })
  @Get('branching-instruction-dynamic-shortcuts')
  async getBranchingInstructionDynamicShortcuts(
    @Query('scenarioId') scenarioId?: number,
  ): Promise<string[]> {
    return this.scenarioService.getBranchingInstructionDynamicShortcuts(
      scenarioId,
    );
  }

  @ApiOperation({ summary: 'Make translations for trigger warnings' })
  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO])
  @Post('trigger-warnings/make-translations')
  async makeTranslationsForTriggerWarnings(): Promise<boolean> {
    return this.triggerWarningService.makeTranslationsForTriggerWarnings();
  }

  @ApiOperation({
    summary: 'Start an AI-vs-AI V2V test session (super-admin only)',
    description:
      'Creates a real scenario session where an AI simulated learner plays the user role. ' +
      'The counselor AI runs as normal; the simulated learner joins via a low-cost TTS/LLM. ' +
      'The session appears in Roleplay Session Logs.',
  })
  @ApiBody({ type: StartV2VTestSessionDto })
  @AuthRoles(...SUPER_ADMIN_ROLES)
  @Post('v2v-test-session-start')
  async startV2VTestSession(
    @CurrentUser() user: TokenUser,
    @Body() dto: StartV2VTestSessionDto,
  ) {
    return this.scenarioSessionService.startV2VTestSession(user.id, dto);
  }
}
