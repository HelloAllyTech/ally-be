import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmAgentModule } from 'src/llm-agent/llm-agent.module';
import { FoundationalSkillAssessment } from './entity/foundational-skill-assessment.entity';
import { FoundationalSkillCut } from './entity/foundational-skill-cut.entity';
import { FoundationalSkillsRepository } from './repository/foundational-skills.repository';
import { FoundationalSkillsJudgeService } from './service/foundational-skills-judge.service';
import { FoundationalSkillsSchedulerRegistrationService } from './service/foundational-skills-scheduler-registration.service';
import { FoundationalSkillsService } from './service/foundational-skills.service';

/**
 * Foundational helping skills — a passive, scenario-independent measure of
 * whether learners' helping skills improve with practice.
 *
 * Every scenario and course defines its own competencies; this module ignores
 * all of them and scores every learner against one fixed ruler, the foundational
 * helping skills rubric (docs/foundational-helping-skills.md), so progress can
 * be compared across whatever people happened to practise.
 *
 * It owns the writing side only (cutting and scoring). The read side is the
 * analytics endpoint `GET /v1/analytics/foundational-skills`, which queries the
 * two tables directly like every other analytics repository, so AnalyticsModule
 * does not depend on this module and this module does not depend on it.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      FoundationalSkillCut,
      FoundationalSkillAssessment,
    ]),
    LlmAgentModule,
  ],
  providers: [
    FoundationalSkillsRepository,
    FoundationalSkillsJudgeService,
    FoundationalSkillsService,
    FoundationalSkillsSchedulerRegistrationService,
  ],
  exports: [FoundationalSkillsService],
})
export class FoundationalSkillsModule {}
