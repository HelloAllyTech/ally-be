import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ScenarioCharacterService } from '../service/scenario-character.service';
import { RequireFeatureToggle } from '../../auth/decorators/feature-toggle.decorator';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
import {
  PreferenceName,
  SUPER_DUPER_ADMIN_ROLES,
} from '../../common/constants/user.constants';
import { ScenarioCharacter } from '../entity/scenario-character.entity';
import {
  ScenarioCharacterSortBy,
  ScenarioCharacterSortOrder,
} from '../enum/scenario-character.enum';
import { ScenarioCharacterRequestDto } from '../dto/scenario-character.dto';
import {
  GetScenarioCharactersResponseDto,
  ScenarioCharacterResponseDto,
} from '../dto/scenario-character.dto';
import { DeleteScenarioCharactersDto } from '../dto/delete-scenario-characters.dto';

@ApiTags('Scenario Character library')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('/v1/scenario-characters')
export class ScenarioCharacterController {
  constructor(
    private readonly scenarioCharacterService: ScenarioCharacterService,
  ) {}

  @ApiOperation({
    summary: 'Get scenario characters with optional search and pagination',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns the list of scenario characters and total count',
    type: GetScenarioCharactersResponseDto,
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by name, profession, or current location',
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
    enum: ScenarioCharacterSortBy,
    default: ScenarioCharacterSortBy.CREATED_AT,
    description: 'Field to sort by (default: createdAt)',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: ScenarioCharacterSortOrder,
    default: ScenarioCharacterSortOrder.DESC,
    description: 'Sort order (default: DESC)',
  })
  @Get()
  @RequireFeatureToggle(FeatureToggleKey.CHARACTER_LIBRARY, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
    tenantPreference: PreferenceName.CHARACTER_LIBRARY_ENABLED,
    permissions: [PERMISSIONS.VIEW_SCENARIO_CHARACTER],
  })
  async getScenarioCharacters(
    @Query('search') search?: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy?: ScenarioCharacterSortBy,
    @Query('sortOrder') sortOrder?: ScenarioCharacterSortOrder,
  ): Promise<GetScenarioCharactersResponseDto> {
    return this.scenarioCharacterService.getScenarioCharacters({
      search,
      limit,
      offset,
      sortBy,
      sortOrder,
    });
  }

  @ApiOperation({ summary: 'Create a new scenario character' })
  @ApiResponse({
    status: 201,
    description: 'Returns the created scenario character',
    type: ScenarioCharacterResponseDto,
  })
  @Post()
  @RequireFeatureToggle(FeatureToggleKey.CHARACTER_LIBRARY, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
    tenantPreference: PreferenceName.CHARACTER_LIBRARY_ENABLED,
    permissions: [PERMISSIONS.CREATE_SCENARIO_CHARACTER],
  })
  async createScenarioCharacter(
    @Body() scenarioCharacterDto: ScenarioCharacterRequestDto,
  ): Promise<ScenarioCharacterResponseDto> {
    return this.scenarioCharacterService.createScenarioCharacter(
      scenarioCharacterDto,
    );
  }

  @RequireFeatureToggle(FeatureToggleKey.CHARACTER_LIBRARY, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
    tenantPreference: PreferenceName.CHARACTER_LIBRARY_ENABLED,
    permissions: [PERMISSIONS.VIEW_SCENARIO_CHARACTER],
  })
  @ApiOperation({ summary: 'Get a scenario character by ID' })
  @ApiResponse({
    status: 200,
    description: 'Returns the scenario character',
    type: ScenarioCharacter,
  })
  @ApiParam({
    name: 'id',
    required: true,
    type: String,
    description: 'Scenario Character ID (UUID)',
  })
  @Get(':id')
  async getScenarioCharacter(
    @Param('id') id: string,
  ): Promise<ScenarioCharacter> {
    return this.scenarioCharacterService.getScenarioCharacterById(id);
  }

  @RequireFeatureToggle(FeatureToggleKey.CHARACTER_LIBRARY, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
    tenantPreference: PreferenceName.CHARACTER_LIBRARY_ENABLED,
    permissions: [PERMISSIONS.EDIT_SCENARIO_CHARACTER],
  })
  @ApiOperation({ summary: 'Update an existing scenario character' })
  @ApiResponse({
    status: 200,
    description: 'Returns the updated scenario character',
    type: ScenarioCharacter,
  })
  @ApiParam({
    name: 'id',
    required: true,
    type: String,
    description: 'Scenario Character ID (UUID)',
  })
  @Put(':id')
  async updateScenarioCharacter(
    @Param('id') id: string,
    @Body() scenarioCharacterDto: ScenarioCharacterRequestDto,
  ): Promise<ScenarioCharacter> {
    return this.scenarioCharacterService.updateScenarioCharacter(
      id,
      scenarioCharacterDto,
    );
  }

  @RequireFeatureToggle(FeatureToggleKey.CHARACTER_LIBRARY, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
    tenantPreference: PreferenceName.CHARACTER_LIBRARY_ENABLED,
    permissions: [PERMISSIONS.DELETE_SCENARIO_CHARACTER],
  })
  @ApiOperation({ summary: 'Delete multiple scenario characters' })
  @ApiBody({ type: DeleteScenarioCharactersDto })
  @ApiResponse({
    status: 200,
    description: 'Returns true if at least one character was deleted',
    schema: { type: 'boolean' },
  })
  @Delete()
  async deleteScenarioCharacters(
    @Body() deleteScenarioCharactersDto: DeleteScenarioCharactersDto,
  ): Promise<boolean> {
    return this.scenarioCharacterService.deleteScenarioCharacters(
      deleteScenarioCharactersDto.scenarioCharacterIds,
    );
  }

  @RequireFeatureToggle(FeatureToggleKey.CHARACTER_LIBRARY, {
    legacyRoles: SUPER_DUPER_ADMIN_ROLES,
    tenantPreference: PreferenceName.CHARACTER_LIBRARY_ENABLED,
    permissions: [PERMISSIONS.DELETE_SCENARIO_CHARACTER],
  })
  @ApiOperation({ summary: 'Delete a scenario character' })
  @ApiResponse({
    status: 200,
    description: 'Returns success status',
    schema: { type: 'object', properties: { success: { type: 'boolean' } } },
  })
  @ApiParam({
    name: 'id',
    required: true,
    type: String,
    description: 'Scenario Character ID (UUID)',
  })
  @Delete(':id')
  async deleteScenarioCharacter(
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    return this.scenarioCharacterService.deleteScenarioCharacter(id);
  }
}
