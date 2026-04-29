import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tooltip } from './entity/tooltip.entity';
import { TooltipRepository } from './repository/tooltip.repository';
import { TooltipService } from './service/tooltip.service';
import { TooltipController } from './controller/tooltip.controller';
import { AuthorizationModule } from 'src/authorization/authorization.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tooltip]),
    AuthorizationModule,
  ],
  controllers: [TooltipController],
  providers: [TooltipService, TooltipRepository],
})
export class TooltipModule {}
