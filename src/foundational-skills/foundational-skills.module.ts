import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LlmAgentModule } from 'src/llm-agent/llm-agent.module';
import { FoundationalSkillAssessment } from './entity/foundational-skill-assessment.entity';
import { FoundationalSkillBenchmarkAssessment } from './entity/foundational-skill-benchmark-assessment.entity';
import { FoundationalSkillCut } from './entity/foundational-skill-cut.entity';
import { FoundationalSkillsRepository } from './repository/foundational-skills.repository';
import { FoundationalSkillsBenchmarkService } from './service/foundational-skills-benchmark.service';
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
 * Beside the cuts it scores the BENCHMARK: every completed session of a
 * roleplay flagged `scenarios.metadata.fhsBenchmark`, judged whole on the same
 * ruler, so each learner's first and latest sessions of one fixed scenario can
 * be compared (constants/fhs-benchmark.constants.ts).
 *
 * It owns the writing side only (cutting and scoring). The read side is the
 * analytics endpoints `GET /v1/analytics/foundational-skills[/benchmark]`,
 * which query the tables directly like every other analytics repository, so
 * AnalyticsModule does not depend on this module and this module does not
 * depend on it.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      FoundationalSkillCut,
      FoundationalSkillAssessment,
      FoundationalSkillBenchmarkAssessment,
    ]),
    LlmAgentModule,
  ],
  providers: [
    FoundationalSkillsRepository,
    FoundationalSkillsJudgeService,
    FoundationalSkillsBenchmarkService,
    FoundationalSkillsService,
    FoundationalSkillsSchedulerRegistrationService,
  ],
  // The judge is shared with the text helpline's QA job (src/helpline), which
  // scores a listener's chats on the same ruler.
  exports: [FoundationalSkillsService, FoundationalSkillsJudgeService],
})
export class FoundationalSkillsModule {}
