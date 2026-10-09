import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmAgentModule } from 'src/llm-agent/llm-agent.module';
import { PromptModule } from 'src/prompt/prompt.module';
import { Prompt } from 'src/prompt/entity/prompt.entity';
import { SkillExperiment } from './entity/skill-experiment.entity';
import { SkillExperimentVariant } from './entity/skill-experiment-variant.entity';
import { SkillExperimentObservation } from './entity/skill-experiment-observation.entity';
import { SkillExperimentEvent } from './entity/skill-experiment-event.entity';
import { SkillExperimentRouterService } from './service/skill-experiment-router.service';
import { SkillExperimentStateService } from './service/skill-experiment-state.service';
import { SkillExperimentJudgeService } from './service/skill-experiment-judge.service';
import { SkillExperimentDesignerService } from './service/skill-experiment-designer.service';
import { SkillExperimentEngineService } from './service/skill-experiment-engine.service';
import { SkillExperimentService } from './service/skill-experiment.service';
import { SkillExperimentSchedulerRegistrationService } from './service/skill-experiment-scheduler-registration.service';
import { SkillExperimentController } from './controller/skill-experiment.controller';

/**
 * Auto-improve for System Skills: A/B tests designer-drafted revisions of a
 * skill against its current best, judged by an LLM against an admin's rubric.
 * See docs/skill-experiments.md.
 *
 * Exports only the router — the one piece a skill's call site needs. It
 * imports nothing that imports it back, so any module that owns a connected
 * skill can import this one.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SkillExperiment,
      SkillExperimentVariant,
      SkillExperimentObservation,
      SkillExperimentEvent,
      Prompt,
    ]),
    PromptModule,
    LlmAgentModule,
  ],
  controllers: [SkillExperimentController],
  providers: [
    SkillExperimentRouterService,
    SkillExperimentStateService,
    SkillExperimentJudgeService,
    SkillExperimentDesignerService,
    SkillExperimentEngineService,
    SkillExperimentService,
    SkillExperimentSchedulerRegistrationService,
  ],
  exports: [SkillExperimentRouterService],
})
export class SkillExperimentModule {}
