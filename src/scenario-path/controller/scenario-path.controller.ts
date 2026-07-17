import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
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
import { TenantScopedPermissions } from 'src/auth/decorators/own-tenant-scope.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { ScenarioPathSortBy, SortOrder } from '../type/scenario-paths.type';
import {
  UpdateScenarioPathResponseDto,
  UpdateScenarioPathDto,
} from '../dto/update-scenario-path.dto';
import { AssignmentStatus, SuccessResponse } from 'src/common/type/common.type';
import { DuplicateScenarioPathResponseDto } from '../dto/duplicate-scenario-path-response.dto';
import { ScenarioPathTenantService } from '../service/scenario-path-tenant.service';
import { CreateScenarioPathTenantDto } from '../dto/create-scenario-path-tenant.dto';
import { DeleteScenarioPathTenantDto } from '../dto/delete-scenario-path-tenant.dto';

@ApiTags('Learn Scenario Paths')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/learn/admin')
export class ScenarioPathController {
  constructor(
    private readonly scenarioPathService: ScenarioPathService,
    private readonly scenarioPathTenantService: ScenarioPathTenantService,
  ) {}

  @ApiOperation({ summary: 'Get scenario paths' })
  @ApiResponse({
    status: 200,
    description: 'List of scenario paths retrieved successfully',
    type: GetScenarioPathsResponseDto,
  })
  @ApiQuery({
    name: 'status',
    required: false,
    type: String,
    description: 'Filter by status (comma-separated)',
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
    name: 'sortBy',
    required: false,
    enum: ScenarioPathSortBy,
    description: 'Field to sort by',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: SortOrder,
    description: 'Sort order',
  })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_SCENARIO_PATHS])
  @Get('scenario-paths')
  async getScenarioPaths(
    @Query('status') status?: string,
    @Query('offset') offset?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('tenantId', new ParseUUIDPipe({ optional: true })) tenantId?: string,
    @Query(
      'assignmentStatus',
      new ParseEnumPipe(AssignmentStatus, { optional: true }),
    )
    assignmentStatus?: AssignmentStatus,
    @Query('sortBy') sortBy: ScenarioPathSortBy = ScenarioPathSortBy.UPDATED_AT,
    @Query('order') order: SortOrder = SortOrder.DESC,
  ): Promise<GetScenarioPathsResponseDto> {
    return this.scenarioPathService.getScenarioPaths({
      status: status?.split(',').map((status) => status.trim()),
      offset,
      limit,
      search,
      tenantId,
      assignmentStatus,
      sortBy,
      order,
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

  @ApiOperation({ description: 'Assign scenario path to a tenant' })
  @ApiResponse({
    description: 'Scenario-path assigned to tenant successfully',
  })
  @TenantScopedPermissions([PERMISSIONS.EDIT_SCENARIO_PATH_TENANT])
  @Post('scenario-paths/tenant/:tenantId')
  async assignScenarioPathsToTenant(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() createScenarioPathTenantDto: CreateScenarioPathTenantDto,
  ) {
    return this.scenarioPathTenantService.assignScenarioPathsToTenant(
      tenantId,
      createScenarioPathTenantDto,
    );
  }

  @ApiOperation({ description: 'Remove scenario path from tenants' })
  @ApiResponse({
    description: 'Scenario path access removed from tenants successfully',
  })
  @TenantScopedPermissions([PERMISSIONS.DELETE_SCENARIO_PATH_TENANT])
  @Delete('scenario-paths/tenant/:tenantId')
  async removeScenarioPathsFromTenant(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() deleteScenarioPathTenantDto: DeleteScenarioPathTenantDto,
  ) {
    return this.scenarioPathTenantService.removeScenarioPathsFromTenant(
      tenantId,
      deleteScenarioPathTenantDto,
    );
  }

  @ApiOperation({ summary: 'Make translations for scenario paths' })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_SCENARIO_PATH])
  @Post('scenario-paths/make-translations')
  async makeTranslationsForScenarioPaths(): Promise<boolean> {
    return this.scenarioPathService.makeTranslationsForScenarioPathItems();
  }
}
