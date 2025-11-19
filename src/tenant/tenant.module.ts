import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './entity/tenant.entity';
import { TenantService } from './service/tenant.service';
import { TenantController } from './controller/tenant.controller';
import { TenantsRepository } from './repository/tenant.repository';
import { UserModule } from 'src/user/user.module';
import { TenantScenarioUtil } from './util/tenant-scenario.util';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant]), forwardRef(() => UserModule)],
  providers: [TenantService, TenantsRepository, TenantScenarioUtil],
  controllers: [TenantController],
  exports: [TenantService],
})
export class TenantModule {}
