import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LabSkill } from './entity/lab-skill.entity';
import { LabVariable } from './entity/lab-variable.entity';
import { LabValue } from './entity/lab-value.entity';
import { LabSkillRepository } from './repository/lab-skill.repository';
import { LabVariableRepository } from './repository/lab-variable.repository';
import { LabValueRepository } from './repository/lab-value.repository';
import { LabSkillService } from './service/lab-skill.service';
import { LabVariableService } from './service/lab-variable.service';
import { LabValueService } from './service/lab-value.service';
import { LabSkillController } from './controller/lab-skill.controller';
import { LabVariableController } from './controller/lab-variable.controller';
import { LabValueController } from './controller/lab-value.controller';

/**
 * AI Lab: a super-duper-admin workspace for authoring reusable system prompts
 * ("skills"), the placeholder variables they reference, and the candidate
 * values bound to those variables. (The "Runs" surface is not built yet.)
 */
@Module({
  imports: [TypeOrmModule.forFeature([LabSkill, LabVariable, LabValue])],
  controllers: [LabSkillController, LabVariableController, LabValueController],
  providers: [
    LabSkillRepository,
    LabVariableRepository,
    LabValueRepository,
    LabSkillService,
    LabVariableService,
    LabValueService,
  ],
})
export class LabModule {}
