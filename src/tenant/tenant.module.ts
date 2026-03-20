import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './entity/tenant.entity';
import { TenantService } from './service/tenant.service';
import { TenantController } from './controller/tenant.controller';
import { TenantsRepository } from './repository/tenant.repository';
import { UserModule } from 'src/user/user.module';
import { TenantScenarioSharedService } from './service/tenant-scenario-shared';
import { TenantScenarioPathSharedService } from './service/tenant-scenario-path-shared';
import { AwsModule } from 'src/aws/aws.module';
import { BadgeTenantSharedService } from 'src/badge/service/badge-tenant-shared.service';
import { TenantDashboardSharedService } from './service/tenant-dashboard-shared';
import { SettingsModule } from 'src/settings/settings.module';
import { TenantCaseSharedService } from './service/tenant-case-shared';
import { AuditModule } from 'src/audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tenant]),
    forwardRef(() => UserModule),
    AwsModule,
    SettingsModule,
    AuditModule,
  ],
  providers: [
    TenantService,
    TenantsRepository,
    TenantScenarioSharedService,
    TenantScenarioPathSharedService,
    BadgeTenantSharedService,
    TenantDashboardSharedService,
    TenantCaseSharedService,
  ],
  controllers: [TenantController],
  exports: [TenantService, TenantsRepository],
})
export class TenantModule {}
