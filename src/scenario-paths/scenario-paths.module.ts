import { Module } from '@nestjs/common';
import { ScenarioPathsController } from './controller/scenario-paths.controller';
import { ScenarioPathsService } from './service/scenario-paths.service';

@Module({
  controllers: [ScenarioPathsController],
  providers: [ScenarioPathsService],
})
export class ScenarioPathsModule {}
