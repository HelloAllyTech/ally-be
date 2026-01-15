import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BadgeController } from './controller/badge.controller';
import { BadgeService } from './service/badge.service';
import { BadgeRepository } from './repository/badge.repository';
import { BadgeGroupRepository } from './repository/badge-group.repository';
import { Badge } from './entity/badge.entity';
import { BadgeUser } from './entity/badge-user.entity';
import { BadgeGroup } from './entity/badge-group.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Badge, BadgeUser, BadgeGroup])],
  controllers: [BadgeController],
  providers: [BadgeService, BadgeRepository, BadgeGroupRepository],
  exports: [BadgeService, BadgeRepository, BadgeGroupRepository],
})
export class BadgeModule {}
