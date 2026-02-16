import { forwardRef, Module } from '@nestjs/common';
import { LanguageModule } from '../language/language.module';
import { LearnController } from './controller/learn.controller';
import { ScenarioService } from './service/scenario.service';
import { Scenarios } from './entity/scenarios.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScenarioSessionService } from './service/scenario-session.service';
import { ScenarioSessions } from './entity/scenario-sessions.entity';
import { ScenarioSessionRepository } from './repository/scenario-session.repository';
import { ScenarioSessionMessagesRepository } from './repository/scenario-session-messages.repository';
import { LiveKitModule } from 'src/livekit/livekit.module';
import { ScenarioSessionFeedbacks } from './entity/scenario-session-feedbacks.entity';
import { ScenarioEvents } from './entity/scenario-events.entity';
import { SessionEventModule } from 'src/session-event/session-event.module';
import { AiModule } from 'src/ai/ai.module';
import { ScenarioSessionMessages } from './entity/scenario-session-messages.entity';
import { LearnMessageAndEventConsumer } from './consumer/learn-message-and-event.consumer';
import { LearnMessageProcessor } from './processor/learn-message.processor';
import { LearnEventProcessor } from './processor/learn-event.processor';
import { ScenarioSessionEvents } from './entity/scenario-session-events.entity';
import { ScenariosRepository } from './repository/scenario.repository';
import { ScenarioVoices } from './entity/scenario-voices.entity';
import { ScenarioVoicesRepository } from './repository/scenario-voices.repository';
import { SimulationCreditsController } from './controller/simulation-credits.controller';
import { SimulationCreditsService } from './service/simulation-credits.service';
import { SimulationCreditsRepository } from './repository/simulation-credits.repository';
import { SimulationCredits } from 'src/learn/entity/simulation-credits.entity';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { UserModule } from 'src/user/user.module';
import { AwsModule } from 'src/aws/aws.module';
import { ScenarioEventsRepository } from './repository/scenario-events.repository';
import { ScenarioSharedService } from './service/scenario-shared.service';
import { ScenarioTenantService } from './service/scenario-tenant.service';
import { ScenarioTenantRepository } from './repository/scenario-tenant.repository';
import { TenantModule } from 'src/tenant/tenant.module';
import { TenantsRepository } from 'src/tenant/repository/tenant.repository';
import { ScenarioTenantValidationShared } from './service/scenario-tenant-validation-shared';
import { ScenarioPathModule } from 'src/scenario-path/scenario-path.module';
import { TriggerWarningsService } from './service/trigger-warnings.service';
import { TriggerWarningsRepository } from './repository/trigger-warnings.repository';
import { TriggerWarnings } from './entity/trigger-warnings.entity';
import { ScenarioTriggerWarnings } from './entity/scenario-trigger-warnings.entity';
import { ScenarioTranslationsRepository } from './repository/scenario-translations.repository';
import { SessionEventTranslationsRepository } from 'src/session-event/repository/session-event-translation.repository';
import { ScenarioEventsTranslationsRepository } from './repository/scenario-events-translations.repository';
import { ReviewModule } from 'src/review/review.module';
import { ConversationalGuardrailsModule } from 'src/conversational-guardrails/conversational-guardrails.module';
import { CaseModule } from 'src/case/case.module';
import { ScenarioSessionDetailsRepository } from './repository/scenario-session-details.repository';
import { ScenarioReportModule } from 'src/scenario-report/scenario-report.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Scenarios,
      ScenarioSessions,
      ScenarioEvents,
      ScenarioSessionFeedbacks,
      ScenarioSessionMessages,
      ScenarioSessionEvents,
      ScenarioVoices,
      SimulationCredits,
      TriggerWarnings,
      ScenarioTriggerWarnings,
    ]),
    forwardRef(() => LiveKitModule),
    SessionEventModule,
    TenantModule,
    forwardRef(() => AiModule),
    forwardRef(() => UserModule),
    AwsModule,
    forwardRef(() => ScenarioPathModule),
    LanguageModule,
    forwardRef(() => ReviewModule),
    forwardRef(() => ConversationalGuardrailsModule),
    forwardRef(() => CaseModule),
    ScenarioReportModule,
  ],
  controllers: [LearnController, SimulationCreditsController],
  providers: [
    ScenarioService,
    ScenarioSessionService,
    ScenarioSessionRepository,
    ScenarioSessionMessagesRepository,
    ScenariosRepository,
    LearnMessageAndEventConsumer,
    LearnMessageProcessor,
    LearnEventProcessor,
    ScenarioVoicesRepository,
    SimulationCreditsService,
    SimulationCreditsRepository,
    PermissionValidator,
    ScenarioEventsRepository,
    ScenarioSharedService,
    ScenarioTenantService,
    ScenarioTenantRepository,
    ScenarioTenantValidationShared,
    TenantsRepository,
    TriggerWarningsRepository,
    TriggerWarningsService,
    ScenariosRepository,
    ScenarioTranslationsRepository,
    SessionEventTranslationsRepository,
    ScenarioEventsTranslationsRepository,
    ScenarioSessionDetailsRepository,
  ],
  exports: [
    LearnMessageProcessor,
    LearnEventProcessor,
    ScenarioSessionService,
    SimulationCreditsService,
    ScenarioSharedService,
    ScenarioService,
    ScenarioTenantService,
  ],
})
export class LearnModule {}
