import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BadgeController } from './controller/badge.controller';
import { BadgeService } from './service/badge.service';
import { BadgeRepository } from './repository/badge.repository';
import { Badge } from './entity/badge.entity';
import { BadgeUser } from './entity/badge-user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Badge, BadgeUser])],
  controllers: [BadgeController],
  providers: [BadgeService, BadgeRepository],
  exports: [BadgeService, BadgeRepository],
})
export class BadgeModule {}
