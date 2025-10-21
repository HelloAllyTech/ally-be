import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../common/entities/tenant.entity';
import { TenantService } from './tenant.service';
import { TenantController } from './tenant.controller';
import { TenantsRepository } from './repository/tenant.repository';
import { User } from 'src/common/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, User])],
  providers: [TenantService, TenantsRepository],
  controllers: [TenantController],
  exports: [TenantService],
})
export class TenantModule {}
