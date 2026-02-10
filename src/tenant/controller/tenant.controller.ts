import { Tenant, TenantStatus } from '../entity/tenant.entity';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { CreateTenantDto } from '../dto/create-tenant.dto';
import { UpdateTenantStatusDto } from '../dto/update-tenant-status.dto';
import { UpdateTenantSettingsDto } from '../dto/update-tenant-settings.dto';
import { UpdateTenantMetadataDto } from '../dto/update-tenant-metadata.dto';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';
import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Put,
  Query,
  Patch,
  Delete,
} from '@nestjs/common';
import { TenantService } from '../service/tenant.service';
import { SortOrder } from 'src/user/enum/user.enum';
import { TenantSortBy } from '../enum/tenant.enum';
import { UpdateTenantDto } from '../dto/update-tenant.dto';
import { GetAllTenantsResponseDto } from '../dto/get-tenants.dto';
import {
  LogoUploadRequestDto,
  OrganizationLogoUploadResponseDto,
} from '../dto/organization-logo-upload.dto';

import { SuccessResponse } from 'src/common/type/common.type';
import { DeleteLogoDto } from '../dto/delete-organization-logo.dto';
import { TenantResponseDto } from '../dto/tenant-response.dto';

@ApiTags('Tenant')
@Controller('v1/tenants')
@ApiBearerAuth()
@ApiSecurity('access-token')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Post()
  @AuthPermissions([PERMISSIONS.EDIT_TENANT])
  async create(@Body() createTenantDto: CreateTenantDto): Promise<Tenant> {
    return this.tenantService.create(createTenantDto, TenantStatus.ACTIVE);
  }

  @AuthPermissions([PERMISSIONS.VIEW_TENANT])
  @Get(':id')
  async findById(@Param('id') id: string): Promise<TenantResponseDto | null> {
    return this.tenantService.findById(id);
  }

  @AuthPermissions([PERMISSIONS.VIEW_TENANT])
  @Get('code/:code')
  async findByCode(
    @Param('code') code: string,
  ): Promise<TenantResponseDto | null> {
    return this.tenantService.findByCode(code);
  }

  @AuthPermissions([PERMISSIONS.EDIT_TENANT])
  @Put(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() updateTenantStatusDto: UpdateTenantStatusDto,
  ): Promise<Tenant | null> {
    return this.tenantService.updateStatus(id, updateTenantStatusDto.status);
  }

  @AuthPermissions([PERMISSIONS.EDIT_TENANT])
  @Put(':id/settings')
  async updateSettings(
    @Param('id') id: string,
    @Body() updateTenantSettingsDto: UpdateTenantSettingsDto,
  ): Promise<Tenant | null> {
    return this.tenantService.updateSettings(
      id,
      updateTenantSettingsDto.settings,
    );
  }

  @AuthPermissions([PERMISSIONS.EDIT_TENANT])
  @Put(':id/metadata')
  async updateMetadata(
    @Param('id') id: string,
    @Body() updateTenantMetadataDto: UpdateTenantMetadataDto,
  ): Promise<Tenant | null> {
    return this.tenantService.updateMetadata(
      id,
      updateTenantMetadataDto.metadata,
    );
  }

  @ApiOperation({ summary: 'Get all tenants' })
  @ApiResponse({
    status: 200,
    description: 'List of tenants',
    type: Tenant,
    isArray: true,
  })
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
    enum: TenantSortBy,
    description: 'Field to sort by',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: SortOrder,
    description: 'Sort order: ASC or DESC',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    isArray: true,
    type: String,
    description: 'Search by name',
  })
  @AuthPermissions([PERMISSIONS.VIEW_TENANTS])
  @Get()
  async getAllTenants(
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
    @Query('sortBy') sortBy?: TenantSortBy,
    @Query('sortOrder') order?: SortOrder,
    @Query('search') search?: string,
  ): Promise<GetAllTenantsResponseDto> {
    return this.tenantService.getallTenants(search, {
      limit,
      offset,
      sortBy,
      order,
    });
  }

  @ApiOperation({ summary: 'Edit tenant details' })
  @ApiResponse({ status: 200, description: 'updated tenant successfully' })
  @AuthPermissions([PERMISSIONS.EDIT_TENANT])
  @Patch(':id')
  async updateTenant(
    @Param('id') id: string,
    @Body() updateTenantDto: UpdateTenantDto,
  ): Promise<TenantResponseDto | null> {
    return this.tenantService.updateTenant(id, updateTenantDto);
  }

  @ApiOperation({ summary: 'Get presigned URL for organization logo upload' })
  @AuthPermissions([PERMISSIONS.EDIT_TENANT])
  @Post('logo-url')
  async getPresignedUrlForOrganizationLogo(
    @Body() logoUploadRequestDto: LogoUploadRequestDto,
  ): Promise<OrganizationLogoUploadResponseDto> {
    return this.tenantService.getPresignedUrlForOrganizationLogo(
      logoUploadRequestDto,
    );
  }

  @ApiOperation({ summary: 'Delete organization logo ' })
  @AuthPermissions([PERMISSIONS.EDIT_TENANT])
  @Delete('logo')
  async deleteOrganizationLogo(
    @Body() deleteLogoDto: DeleteLogoDto,
  ): Promise<SuccessResponse> {
    return this.tenantService.deleteOrganizationLogo(deleteLogoDto);
  }
}
