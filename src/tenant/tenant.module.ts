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

@Module({
  imports: [
    TypeOrmModule.forFeature([Tenant]),
    forwardRef(() => UserModule),
    AwsModule,
  ],
  providers: [
    TenantService,
    TenantsRepository,
    TenantScenarioSharedService,
    TenantScenarioPathSharedService,
  ],
  controllers: [TenantController],
  exports: [TenantService, TenantsRepository],
})
export class TenantModule {}
