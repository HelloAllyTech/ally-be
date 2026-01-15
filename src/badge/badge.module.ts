import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BadgeController } from './controller/badge.controller';
import { BadgeService } from './service/badge.service';
import { BadgeTenantService } from './service/badge-tenant.service';
import { BadgeRepository } from './repository/badge.repository';
import { BadgeGroupRepository } from './repository/badge-group.repository';
import { Badge } from './entity/badge.entity';
import { BadgeUser } from './entity/badge-user.entity';
import { BadgeGroup } from './entity/badge-group.entity';
import { BadgeTenant } from './entity/badge-tenant.entity';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Badge, BadgeUser, BadgeGroup, BadgeTenant]),
    TenantModule,
  ],
  controllers: [BadgeController],
  providers: [
    BadgeService,
    BadgeTenantService,
    BadgeRepository,
    BadgeGroupRepository,
  ],
  exports: [
    BadgeService,
    BadgeTenantService,
    BadgeRepository,
    BadgeGroupRepository,
  ],
})
export class BadgeModule {}
