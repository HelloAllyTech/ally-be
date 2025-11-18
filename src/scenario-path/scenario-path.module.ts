import { Module } from '@nestjs/common';
import { ScenarioPathController } from './controller/scenario-path.controller';
import { ScenarioPathService } from './service/scenario-path.service';
import { ScenarioPathRepository } from './repository/scenario-path.repository';
import { ScenarioPathItemRepository } from './repository/scenario-path-item.repository';
import { LearnModule } from 'src/learn/learn.module';
import { ScenarioPathSessionService } from './service/scenario-path-session.service';
import { ScenarioPathSessionRepository } from './repository/scenario-path-session.repository';

@Module({
  imports: [LearnModule],
  controllers: [ScenarioPathController],
  providers: [
    ScenarioPathService,
    ScenarioPathRepository,
    ScenarioPathItemRepository,
    ScenarioPathSessionService,
    ScenarioPathSessionRepository,
  ],
})
export class ScenarioPathModule {}
