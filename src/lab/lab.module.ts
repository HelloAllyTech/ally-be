import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LabSkill } from './entity/lab-skill.entity';
import { LabVariable } from './entity/lab-variable.entity';
import { LabValue } from './entity/lab-value.entity';
import { LabRun } from './entity/lab-run.entity';
import { LabSkillRepository } from './repository/lab-skill.repository';
import { LabVariableRepository } from './repository/lab-variable.repository';
import { LabValueRepository } from './repository/lab-value.repository';
import { LabRunRepository } from './repository/lab-run.repository';
import { LabSkillService } from './service/lab-skill.service';
import { LabVariableService } from './service/lab-variable.service';
import { LabValueService } from './service/lab-value.service';
import { LabRunService } from './service/lab-run.service';
import { LabSkillController } from './controller/lab-skill.controller';
import { LabVariableController } from './controller/lab-variable.controller';
import { LabValueController } from './controller/lab-value.controller';
import { LabRunController } from './controller/lab-run.controller';

/**
 * AI Lab: a super-duper-admin workspace for authoring reusable system prompts
 * ("skills"), the placeholder variables they reference, the candidate values
 * bound to those variables, and runs that execute skills with values
 * substituted in (one runs-log row per skill execution).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([LabSkill, LabVariable, LabValue, LabRun]),
  ],
  controllers: [
    LabSkillController,
    LabVariableController,
    LabValueController,
    LabRunController,
  ],
  providers: [
    LabSkillRepository,
    LabVariableRepository,
    LabValueRepository,
    LabRunRepository,
    LabSkillService,
    LabVariableService,
    LabValueService,
    LabRunService,
  ],
})
export class LabModule {}
