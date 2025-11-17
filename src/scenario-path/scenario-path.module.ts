import { Module } from '@nestjs/common';
import { ScenarioPathController } from './controller/scenario-path.controller';
import { ScenarioPathService } from './service/scenario-path.service';
import { ScenarioPathRepository } from './repository/scenario-path.repository';
import { ScenarioPathItemRepository } from './repository/scenario-path-item.repository';
import { LearnModule } from 'src/learn/learn.module';

@Module({
  imports: [LearnModule],
  controllers: [ScenarioPathController],
  providers: [
    ScenarioPathService,
    ScenarioPathRepository,
    ScenarioPathItemRepository,
  ],
})
export class ScenarioPathModule {}
