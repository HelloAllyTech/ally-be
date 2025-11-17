import { Body, Controller, Get, Post, Query } from '@nestjs/common';
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

@ApiTags('Learn Scenario Paths')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/learn/admin')
export class ScenarioPathController {
  constructor(private readonly scenarioPathService: ScenarioPathService) {}

  @ApiOperation({ description: 'Get scenario paths' })
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

  @ApiOperation({ description: 'Create scenario path' })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_SCENARIO_PATH])
  @Post('scenario-paths')
  async createScenarioPath(
    @Body() createScenarioPathDto: CreateScenarioPathDto,
  ): Promise<CreateScenarioPathResponseDto> {
    return this.scenarioPathService.createScenarioPath(createScenarioPathDto);
  }
}
