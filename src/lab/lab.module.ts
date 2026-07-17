import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';

import { AwsModule } from '../aws/aws.module';

import { LabSkill } from './entity/lab-skill.entity';
import { LabVariable } from './entity/lab-variable.entity';
import { LabValue } from './entity/lab-value.entity';
import { LabRun } from './entity/lab-run.entity';
import { LabEvalQuestion } from './entity/lab-eval-question.entity';
import { LabEvaluator } from './entity/lab-evaluator.entity';
import { LabRunAssignment } from './entity/lab-run-assignment.entity';
import { LabEvalAnswer } from './entity/lab-eval-answer.entity';
import { LabSkillRepository } from './repository/lab-skill.repository';
import { LabVariableRepository } from './repository/lab-variable.repository';
import { LabValueRepository } from './repository/lab-value.repository';
import { LabRunRepository } from './repository/lab-run.repository';
import { LabEvaluatorRepository } from './repository/lab-evaluator.repository';
import {
  LabEvalAnswerRepository,
  LabEvalQuestionRepository,
  LabRunAssignmentRepository,
} from './repository/lab-eval.repositories';
import { LabSkillService } from './service/lab-skill.service';
import { LabVariableService } from './service/lab-variable.service';
import { LabValueService } from './service/lab-value.service';
import { LabRunService } from './service/lab-run.service';
import { LabEvaluatorService } from './service/lab-evaluator.service';
import { LabEvalService } from './service/lab-eval.service';
import { LabEvaluatorGuard } from './guard/lab-evaluator.guard';
import { LabRunProducer } from './producer/lab-run.producer';
import { LabRunConsumer } from './consumer/lab-run.consumer';
import { LabSkillController } from './controller/lab-skill.controller';
import { LabVariableController } from './controller/lab-variable.controller';
import { LabValueController } from './controller/lab-value.controller';
import { LabRunController } from './controller/lab-run.controller';
import { LabEvaluatorController } from './controller/lab-evaluator.controller';
import { LabEvalPortalController } from './controller/lab-eval-portal.controller';

/**
 * AI Lab: a super-duper-admin workspace for authoring reusable system prompts
 * ("skills"), the placeholder variables they reference, the candidate values
 * bound to those variables, runs that execute skills with values substituted
 * in (one runs-log row per skill execution), and human evaluation of
 * published runs (evaluator accounts, assignments, the /evaluate portal and
 * aggregated results).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      LabSkill,
      LabVariable,
      LabValue,
      LabRun,
      LabEvalQuestion,
      LabEvaluator,
      LabRunAssignment,
      LabEvalAnswer,
    ]),
    AwsModule,
  ],
  controllers: [
    LabSkillController,
    LabVariableController,
    LabValueController,
    LabRunController,
    LabEvaluatorController,
    LabEvalPortalController,
  ],
  providers: [
    LabSkillRepository,
    LabVariableRepository,
    LabValueRepository,
    LabRunRepository,
    LabEvaluatorRepository,
    LabEvalQuestionRepository,
    LabRunAssignmentRepository,
    LabEvalAnswerRepository,
    LabSkillService,
    LabVariableService,
    LabValueService,
    LabRunService,
    LabEvaluatorService,
    LabEvalService,
    LabEvaluatorGuard,
    LabRunProducer,
    LabRunConsumer,
    // Default-config JwtService (same pattern as ChatModule): secrets are
    // passed per sign/verify call from AppConfigService.
    JwtService,
  ],
})
export class LabModule {}
