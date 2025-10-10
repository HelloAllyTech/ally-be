import { Controller, Get, Post, Body, Param, Put } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { Tenant, TenantStatus } from '../common/entities/tenant.entity';
import { ApiBearerAuth, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import { UpdateTenantMetadataDto } from './dto/update-tenant-metadata.dto';
import { UserRole } from '../common/constants/user.constants';
import { AuthRoles } from '../auth/decorators/auth-roles.decorator';

@ApiTags('Tenant')
@ApiBearerAuth()
@ApiSecurity('access-token')
@Controller('v1/tenants')
@AuthRoles(UserRole.SUPER_ADMIN)
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Post()
  async create(@Body() createTenantDto: CreateTenantDto): Promise<Tenant> {
    return this.tenantService.create({
      ...createTenantDto,
      status: TenantStatus.ACTIVE,
    });
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<Tenant | null> {
    return this.tenantService.findById(id);
  }

  @Get('code/:code')
  async findByCode(@Param('code') code: string): Promise<Tenant | null> {
    return this.tenantService.findByCode(code);
  }

  @Put(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() updateTenantStatusDto: UpdateTenantStatusDto,
  ): Promise<Tenant | null> {
    return this.tenantService.updateStatus(id, updateTenantStatusDto.status);
  }

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
