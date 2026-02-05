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
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiSecurity,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { ScenarioCharacterService } from '../service/scenario-character.service';
import { AuthPermissions } from '../../auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from '../../authorization/constants/permissions.constants';
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
    description: 'Field to sort by (default: name)',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: ScenarioCharacterSortOrder,
    description: 'Sort order (default: ASC)',
  })
  @Get()
  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_CHARACTER])
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
  @AuthPermissions([PERMISSIONS.CREATE_SCENARIO_CHARACTER])
  async createScenarioCharacter(
    @Body() scenarioCharacterDto: ScenarioCharacterRequestDto,
  ): Promise<ScenarioCharacterResponseDto> {
    return this.scenarioCharacterService.createScenarioCharacter(
      scenarioCharacterDto,
    );
  }

  @AuthPermissions([PERMISSIONS.VIEW_SCENARIO_CHARACTER])
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

  @AuthPermissions([PERMISSIONS.EDIT_SCENARIO_CHARACTER])
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

  @AuthPermissions([PERMISSIONS.DELETE_SCENARIO_CHARACTER])
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
