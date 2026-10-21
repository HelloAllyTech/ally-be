import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DebriefFeedback } from './entity/debrief-feedback.entity';
import { DebriefFeedbackService } from './service/debrief-feedback.service';
import { DebriefFeedbackController } from './controller/debrief-feedback.controller';
import { SkillExperimentObservation } from 'src/skill-experiment/entity/skill-experiment-observation.entity';
import { ScenarioSessions } from 'src/learn/entity/scenario-sessions.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DebriefFeedback,
      SkillExperimentObservation,
      ScenarioSessions,
    ]),
  ],
  providers: [DebriefFeedbackService],
  controllers: [DebriefFeedbackController],
  exports: [DebriefFeedbackService],
})
export class DebriefFeedbackModule {}
