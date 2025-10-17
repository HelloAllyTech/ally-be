import { Controller, Get, Post, Body, Param, Put } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { Tenant, TenantStatus } from '../common/entities/tenant.entity';
import { ApiTags } from '@nestjs/swagger';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import { UpdateTenantMetadataDto } from './dto/update-tenant-metadata.dto';
import { AuthPermissions } from 'src/auth/decorators/auth-permissions.decorator';
import { PERMISSIONS } from 'src/authorization/constants/permissions.constants';

@ApiTags('Tenant')
@Controller('v1/tenants')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Post()
  @AuthPermissions([PERMISSIONS.EDIT_TENANT])
  async create(@Body() createTenantDto: CreateTenantDto): Promise<Tenant> {
    return this.tenantService.create({
      ...createTenantDto,
      status: TenantStatus.ACTIVE,
    });
  }

  @AuthPermissions([PERMISSIONS.VIEW_TENANT])
  @Get(':id')
  async findById(@Param('id') id: string): Promise<Tenant | null> {
    return this.tenantService.findById(id);
  }

  @AuthPermissions([PERMISSIONS.VIEW_TENANT])
  @Get('code/:code')
  async findByCode(@Param('code') code: string): Promise<Tenant | null> {
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
}
