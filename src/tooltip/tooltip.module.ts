import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TooltipController } from './controller/tooltip.controller';
import { Tooltip } from './entity/tooltip.entity';
import { TooltipRepository } from './repository/tooltip.repository';
import { TooltipService } from './service/tooltip.service';

@Module({
  imports: [TypeOrmModule.forFeature([Tooltip])],
  controllers: [TooltipController],
  providers: [TooltipService, TooltipRepository],
})
export class TooltipModule {}
