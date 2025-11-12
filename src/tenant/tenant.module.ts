import { forwardRef, Module } from '@nestjs/common';
import { TenantService } from './service/tenant.service';
import { TenantController } from './controller/tenant.controller';
import { TenantsRepository } from './repository/tenant.repository';
import { UserModule } from 'src/user/user.module';

@Module({
  imports: [forwardRef(() => UserModule)],
  providers: [TenantService, TenantsRepository],
  controllers: [TenantController],
  exports: [TenantService],
})
export class TenantModule {}
