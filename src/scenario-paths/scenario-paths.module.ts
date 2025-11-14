import { Module } from '@nestjs/common';
import { ScenarioPathsController } from './controller/scenario-paths.controller';
import { ScenarioPathsService } from './service/scenario-paths.service';
import { ScenarioPathRepository } from './repository/scenario-path.repository';
import { ScenarioPathItemRepository } from './repository/scenario-path-item.repository';
import { LearnModule } from 'src/learn/learn.module';

@Module({
  imports: [LearnModule],
  controllers: [ScenarioPathsController],
  providers: [
    ScenarioPathsService,
    ScenarioPathRepository,
    ScenarioPathItemRepository,
  ],
})
export class ScenarioPathsModule {}
