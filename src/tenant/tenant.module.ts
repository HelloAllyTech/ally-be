import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../common/entities/tenant.entity';
import { TenantService } from './service/tenant.service';
import { TenantController } from './controller/tenant.controller';
import { TenantsRepository } from './repository/tenant.repository';
import { User } from 'src/common/entities/user.entity';
import { UserModule } from 'src/user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tenant, User]),
    forwardRef(() => UserModule),
  ],
  providers: [TenantService, TenantsRepository],
  controllers: [TenantController],
  exports: [TenantService],
})
export class TenantModule {}
