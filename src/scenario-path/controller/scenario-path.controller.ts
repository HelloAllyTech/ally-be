import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
import {
  CreateScenarioPathDto,
  CreateScenarioPathResponseDto,
} from '../dto/create-scenario-path.dto';
import { GetScenarioPathsResponseDto } from '../dto/scenario-paths-response.dto';
import { ScenarioPathService } from '../service/scenario-path.service';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ScenarioPathStatus } from '../type/scenario-paths.type';
import {
  UpdateScenarioPathResponseDto,
  UpdateScenarioPathDto,
} from '../dto/update-scenario-path.dto';
import { SuccessResponse } from 'src/common/type/common.type';
import { DuplicateScenarioPathResponseDto } from '../dto/duplicate-scenario-path-response.dto';

@ApiTags('Learn Scenario Paths')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/learn/admin')
export class ScenarioPathController {
  constructor(private readonly scenarioPathService: ScenarioPathService) {}

  @ApiOperation({ summary: 'Get scenario paths' })
  @ApiResponse({
    status: 200,
    description: 'List of scenario paths retrieved successfully',
    type: GetScenarioPathsResponseDto,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ScenarioPathStatus,
    description: 'Filter by status',
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
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Search by title or description',
  })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_SCENARIO_PATH])
  @Get('scenario-paths')
  async getScenarioPaths(
    @Query('status') status?: ScenarioPathStatus,
    @Query('offset') offset?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ): Promise<GetScenarioPathsResponseDto> {
    return this.scenarioPathService.getScenarioPaths({
      status,
      offset,
      limit,
      search,
    });
  }

  @ApiOperation({ summary: 'Get scenario path by id' })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_SCENARIO_PATH])
  @Get('scenario-paths/:id')
  async getScenarioPathById(@Param('id', ParseUUIDPipe) id: string) {
    return this.scenarioPathService.getScenarioPathById(id);
  }

  @ApiOperation({ summary: 'Create scenario path' })
  @ApiResponse({
    status: 201,
    description: 'Scenario path created successfully',
    type: CreateScenarioPathResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_SCENARIO_PATH])
  @Post('scenario-paths')
  async createScenarioPath(
    @Body() createScenarioPathDto: CreateScenarioPathDto,
  ): Promise<CreateScenarioPathResponseDto> {
    return this.scenarioPathService.createScenarioPath(createScenarioPathDto);
  }

  @ApiOperation({ summary: 'Edit scenario path' })
  @ApiResponse({
    status: 200,
    description: 'Scenario path updated successfully',
    type: UpdateScenarioPathResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_SCENARIO_PATH])
  @Put('scenario-paths/:id')
  async updateScenarioPath(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateScenarioPathDto: UpdateScenarioPathDto,
  ): Promise<UpdateScenarioPathResponseDto> {
    return this.scenarioPathService.updateScenarioPath(
      id,
      updateScenarioPathDto,
    );
  }

  @ApiOperation({ summary: 'Delete scenario path' })
  @ApiResponse({
    status: 200,
    description: 'Scenario path deleted successfully',
  })
  @AuthPermissions([PERMISSIONS.DELETE_ADMIN_SCENARIO_PATH])
  @Delete('scenario-paths/:id')
  async deleteScenarioPath(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SuccessResponse> {
    return this.scenarioPathService.deleteScenarioPath(id);
  }

  @ApiOperation({ summary: 'Duplicate scenario path' })
  @ApiResponse({
    status: 200,
    description: 'Scenario path duplicated successfully',
    type: DuplicateScenarioPathResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_SCENARIO_PATH])
  @Post('scenario-paths/:id/duplicate')
  async duplicateScenarioPath(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DuplicateScenarioPathResponseDto> {
    return this.scenarioPathService.duplicateScenarioPath(id);
  }
}
