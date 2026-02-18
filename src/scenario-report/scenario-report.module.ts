import { forwardRef, Module } from '@nestjs/common';
import { ScenarioReportController } from './controller/scenario-report.controller';
import { ScenarioReportService } from './service/scenario-report.service';
import { ScenarioReport } from './entity/scenario-report.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScenarioReportTranscript } from './entity/scenario-report-transcript.entity';
import { ScenarioReportTranscriptService } from './service/scenario-report-transcript.service';
import { ScenarioReportGateway } from './gateway/scenario-report.gateway';
import { ScenarioReportNotificationService } from './service/scenario-report-notification.service';
import { ScenarioReportRepository } from './repository/scenario-report.repository';
import { AiModule } from '../ai/ai.module';
import { LanguageModule } from '../language/language.module';
import { ScenarioReportWebhookController } from './controller/scenario-report-webhook.controller';
import { LearnModule } from 'src/learn/learn.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ScenarioReport]),
    TypeOrmModule.forFeature([ScenarioReportTranscript]),
    AiModule,
    LanguageModule,
    forwardRef(() => LearnModule),
  ],
  controllers: [ScenarioReportController, ScenarioReportWebhookController],
  providers: [
    ScenarioReportRepository,
    ScenarioReportService,
    ScenarioReportTranscriptService,
    ScenarioReportGateway,
    ScenarioReportNotificationService,
  ],
  exports: [ScenarioReportService],
})
export class ScenarioReportModule {}
