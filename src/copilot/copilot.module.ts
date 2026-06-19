import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CopilotRun } from './entity/copilot-run.entity';
import { CopilotRunRepository } from './repository/copilot-run.repository';
import { CopilotService } from './service/copilot.service';
import { CopilotController } from './controller/copilot.controller';
import { LearnModule } from 'src/learn/learn.module';
import { ScenarioReportModule } from 'src/scenario-report/scenario-report.module';
import { PromptModule } from 'src/prompt/prompt.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CopilotRun]),
    forwardRef(() => LearnModule),
    ScenarioReportModule,
    forwardRef(() => PromptModule),
  ],
  controllers: [CopilotController],
  providers: [CopilotRunRepository, CopilotService],
  exports: [CopilotService],
})
export class CopilotModule {}
