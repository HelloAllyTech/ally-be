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
  ApiTags,
  ApiBearerAuth,
  ApiSecurity,
  ApiOperation,
  ApiResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import { CreateCaseDto, CreateCaseResponseDto } from '../dto/create-case.dto';
import { CaseService } from '../service/case.service';
import { GetCaseResponseDto } from '../dto/case-response.dto';
import { CaseSortBy } from '../type/cases.type';
import { SortOrder, SuccessResponse } from 'src/common/type/common.type';
import { UpdateCaseDto, UpdateCaseResponseDto } from '../dto/update-case.dto';
import { DuplicateCaseResponseDto } from '../dto/duplicate-case.dto';
import { CreateCaseTenantDto } from '../dto/create-case-tenant.dto';
import { CaseTenantService } from '../service/case-tenant.service';
import { DeleteCaseTenantDto } from '../dto/delete-case-tenant';

@ApiTags('Cases')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/learn/admin')
export class CaseController {
  constructor(
    private readonly caseService: CaseService,
    private readonly caseTenantService: CaseTenantService,
  ) {}

  @ApiOperation({ summary: 'Get cases' })
  @ApiResponse({
    status: 200,
    description: 'List of cases retrieved successfully',
    type: GetCaseResponseDto,
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
    name: 'sortBy',
    required: false,
    enum: CaseSortBy,
    description: 'Field to sort by',
  })
  @ApiQuery({
    name: 'order',
    required: false,
    enum: SortOrder,
    description: 'Sort order',
  })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_CASES])
  @Get('cases')
  async getCases(
    @Query('status') status?: string,
    @Query('offset') offset?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('tenantId', new ParseUUIDPipe({ optional: true })) tenantId?: string,
    @Query('sortBy') sortBy: CaseSortBy = CaseSortBy.UPDATED_AT,
    @Query('order') order: SortOrder = SortOrder.DESC,
  ): Promise<GetCaseResponseDto> {
    return this.caseService.getCases({
      status: status?.split(',').map((status) => status.trim()),
      offset,
      limit,
      search,
      tenantId,
      sortBy,
      order,
    });
  }

  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_CASE])
  @Post('cases')
  async createCase(
    @Body() createCaseDto: CreateCaseDto,
  ): Promise<CreateCaseResponseDto> {
    return this.caseService.createCase(createCaseDto);
  }

  @ApiOperation({ summary: 'Get case by id' })
  @AuthPermissions([PERMISSIONS.VIEW_ADMIN_SCENARIO_PATH])
  @Get('cases/:id')
  async getCaseById(@Param('id', ParseUUIDPipe) id: string) {
    return this.caseService.getCaseById(id);
  }

  @ApiOperation({ summary: 'Edit case' })
  @ApiResponse({
    status: 200,
    description: 'Case updated successfully',
    type: UpdateCaseResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_CASE])
  @Put('cases/:id')
  async updateCase(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateCaseDto: UpdateCaseDto,
  ): Promise<UpdateCaseResponseDto> {
    return this.caseService.updateCase(id, updateCaseDto);
  }

  @ApiOperation({ summary: 'Delete case' })
  @ApiResponse({
    status: 200,
    description: 'Case deleted successfully',
  })
  @AuthPermissions([PERMISSIONS.DELETE_ADMIN_CASE])
  @Delete('cases/:id')
  async deleteCase(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SuccessResponse> {
    return this.caseService.deleteCase(id);
  }

  @ApiOperation({ summary: 'Duplicate case' })
  @ApiResponse({
    status: 200,
    description: 'Case duplicated successfully',
    type: DuplicateCaseResponseDto,
  })
  @AuthPermissions([PERMISSIONS.EDIT_ADMIN_CASE])
  @Post('cases/:id/duplicate')
  async duplicateCase(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DuplicateCaseResponseDto> {
    return this.caseService.duplicateCase(id);
  }

  @ApiOperation({ description: 'Assign case to a tenant' })
  @ApiResponse({
    description: 'Case assigned to tenant successfully',
  })
  @AuthPermissions([PERMISSIONS.EDIT_CASE_TENANT])
  @Post('cases/tenant/:tenantId')
  async assignCasesToTenant(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() createCaseTenantDto: CreateCaseTenantDto,
  ) {
    return this.caseTenantService.assignCasesToTenant(
      tenantId,
      createCaseTenantDto,
    );
  }

  @ApiOperation({ description: 'Remove case from tenants' })
  @ApiResponse({
    description: 'Case access removed from tenants successfully',
  })
  @AuthPermissions([PERMISSIONS.DELETE_CASE_TENANT])
  @Delete('cases/tenant/:tenantId')
  async removeCasesFromTenant(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() deleteCaseTenantDto: DeleteCaseTenantDto,
  ) {
    return this.caseTenantService.removeCasesFromTenant(
      tenantId,
      deleteCaseTenantDto,
    );
  }
}
