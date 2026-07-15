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
import { ScenarioSessionLifecycleEvent } from './entity/scenario-session-lifecycle-event.entity';
import { ScenarioEvents } from './entity/scenario-events.entity';
import { SessionEventModule } from 'src/session-event/session-event.module';
import { AiModule } from 'src/ai/ai.module';
import { ScenarioSessionMessages } from './entity/scenario-session-messages.entity';
import { LearnMessageAndEventConsumer } from './consumer/learn-message-and-event.consumer';
import { LearnMessageProcessor } from './processor/learn-message.processor';
import { LearnEventProcessor } from './processor/learn-event.processor';
import { ScenarioSessionEvents } from './entity/scenario-session-events.entity';
import { ScenariosRepository } from './repository/scenario.repository';
import { ScenarioVersion } from './entity/scenario-version.entity';
import { ScenarioVersionRepository } from './repository/scenario-version.repository';
import { ScenarioVersionService } from './service/scenario-version.service';
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
import { ScenarioSessionReviewModule } from 'src/scenario-session-review/scenario-session-review.module';
import { ConversationalGuardrailsModule } from 'src/conversational-guardrails/conversational-guardrails.module';
import { CaseModule } from 'src/case/case.module';
import { TrackModule } from 'src/track/track.module';
import { ScenarioSessionDetailsRepository } from './repository/scenario-session-details.repository';
import { ScenarioReportModule } from 'src/scenario-report/scenario-report.module';
import { ScenarioSessionTags } from './entity/scenario-session-tags.entity';
import { ScenarioSessionMessageTags } from './entity/scenario-session-message-tags.entity';
import { ScenarioSessionTagsRepository } from './repository/scenario-session-tags.repository';
import { ScenarioSessionMessageTagsRepository } from './repository/scenario-session-message-tags.repository';
import { ScenarioSessionReflectionPromptResponse } from './entity/scenario-session-reflection-prompt-response.entity';
import { Behavior } from './entity/behavior.entity';
import { FillerTag } from './entity/filler-tag.entity';
import { ScenarioBehaviorInstruction } from './entity/scenario-behavior-instruction.entity';
import { ScenarioBehaviorInstructionBehavior } from './entity/scenario-behavior-instruction-behavior.entity';
import { BehaviorController } from './controller/behavior.controller';
import { FillerTagController } from './controller/filler-tag.controller';
import { BehaviorService } from './service/behavior.service';
import { FillerTagService } from './service/filler-tag.service';
import { BehaviorRepository } from './repository/behavior.repository';
import { FillerTagRepository } from './repository/filler-tag.repository';
import { ScenarioBehaviorInstructionService } from './service/scenario-behavior-instruction.service';
import { ScenarioBehaviorInstructionRepository } from './repository/scenario-behavior-instruction.repository';
import { ScenarioBehaviorInstructionBehaviorRepository } from './repository/scenario-behavior-instruction-behavior.repository';
import { PromptModule } from 'src/prompt/prompt.module';
import { AiChatModule } from 'src/ai-chat/ai-chat.module';
import { ScenarioSessionChat } from './entity/scenario-session-chat.entity';
import { ScenarioSessionChatMessage } from './entity/scenario-session-chat-message.entity';
import { ScenarioSessionChatRepository } from './repository/scenario-session-chat.repository';
import { ScenarioSessionChatMessageRepository } from './repository/scenario-session-chat-message.repository';
import { ScenarioSessionContextProvider } from './service/scenario-session-context.provider';
import { ScenarioSessionChatService } from './service/scenario-session-chat.service';
import { ScenarioSessionChatController } from './controller/scenario-session-chat.controller';
import { BehaviorInstructionProcessor } from './processor/behavior-instruction.processor';
import { TurnMetricsProcessor } from './processor/turn-metrics.processor';
import { StartMetricsProcessor } from './processor/start-metrics.processor';
import { LlmUsageProcessor } from './processor/llm-usage.processor';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';
import { ScenarioSessionBehaviorInstructions } from './entity/scenario-session-behavior-instructions.entity';
import { Competency } from './entity/competency.entity';
import { CompetencyRepository } from './repository/competency.repository';
import { CompetencyService } from './service/competency.service';
import { CompetencyController } from './controller/competency.controller';
import { AgentTestCase } from './entity/agent-test-case.entity';
import { AgentTestCaseRepository } from './repository/agent-test-case.repository';
import { AgentTestCaseService } from './service/agent-test-case.service';
import { ScenarioSessionEvaluationService } from './service/scenario-session-evaluation.service';
import { ScenarioSessionEvaluationWebhookController } from './controller/scenario-session-evaluation-webhook.controller';
import { AgentTestCaseController } from './controller/agent-test-case.controller';
import { CompetencyBehavior } from './entity/competency-behavior.entity';
import { CompetencyBehaviorRepository } from './repository/competency-behavior.repository';
import { BehaviorTranslation } from './entity/behavior-translation.entity';
import { ScenarioBehaviorInstructionTranslation } from './entity/scenario-behavior-instruction-translation.entity';
import { BehaviorTranslationRepository } from './repository/behavior-translation.repository';
import { ScenarioBehaviorInstructionTranslationRepository } from './repository/scenario-behavior-instruction-translation.repository';
import { BehaviorTranslationService } from './service/behavior-translation.service';
import { ScenarioBehaviorInstructionTranslationService } from './service/scenario-behavior-instruction-translation.service';
import { BehaviorInstructionTranslationService } from './service/behavior-instruction-translation.service';
import { OpenAIAutofillService } from './service/openai-autofil-service';
import { AnthropicAutofillService } from './service/anthropic-autofill.service';
import { ScenarioTranslationGateway } from './gateway/scenario-translation.gateway';
import { ScenarioTranslationNotificationService } from './service/scenario-translation-notification.service';

import { AuditModule } from 'src/audit/audit.module';
import { ScenarioSessionRecording } from './entity/scenario-session-recording.entity';
import { ScenarioSessionRecordingRepository } from './repository/scenario-session-recording.repository';
import { ScenarioSessionRecordingController } from './controller/scenario-session-recording.controller';
import { ScenarioSessionRecordingService } from './service/scenario-session-recording.service';
import { TranscriptTranslationModule } from 'src/transcript-translation/transcript-translation.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Scenarios,
      ScenarioSessions,
      ScenarioEvents,
      ScenarioSessionFeedbacks,
      ScenarioSessionLifecycleEvent,
      ScenarioSessionMessages,
      ScenarioSessionEvents,
      ScenarioVoices,
      SimulationCredits,
      TriggerWarnings,
      ScenarioTriggerWarnings,
      ScenarioSessionTags,
      ScenarioSessionMessageTags,
      ScenarioSessionReflectionPromptResponse,
      Behavior,
      FillerTag,
      ScenarioBehaviorInstruction,
      ScenarioBehaviorInstructionBehavior,
      ScenarioSessionChat,
      ScenarioSessionChatMessage,
      ScenarioSessionBehaviorInstructions,
      Competency,
      CompetencyBehavior,
      AgentTestCase,
      BehaviorTranslation,
      ScenarioBehaviorInstructionTranslation,
      AuditModule,
      ScenarioSessionRecording,
      ScenarioVersion,
    ]),
    forwardRef(() => LiveKitModule),
    SessionEventModule,
    TenantModule,
    forwardRef(() => AiModule),
    forwardRef(() => UserModule),
    AwsModule,
    forwardRef(() => ScenarioPathModule),
    LanguageModule,
    forwardRef(() => ScenarioSessionReviewModule),
    forwardRef(() => ConversationalGuardrailsModule),
    forwardRef(() => CaseModule),
    forwardRef(() => TrackModule),
    forwardRef(() => PromptModule),
    ScenarioReportModule,
    forwardRef(() => ConversationalGuardrailsModule),
    AiChatModule,
    AuditModule,
    LlmUsageModule,
    TranscriptTranslationModule,
  ],
  controllers: [
    LearnController,
    SimulationCreditsController,
    BehaviorController,
    FillerTagController,
    ScenarioSessionChatController,
    CompetencyController,
    AgentTestCaseController,
    ScenarioSessionRecordingController,
    ScenarioSessionEvaluationWebhookController,
  ],
  providers: [
    ScenarioService,
    ScenarioVersionService,
    ScenarioVersionRepository,
    ScenarioSessionService,
    ScenarioSessionRepository,
    ScenarioSessionMessagesRepository,
    ScenariosRepository,
    LearnMessageAndEventConsumer,
    LearnMessageProcessor,
    LearnEventProcessor,
    BehaviorInstructionProcessor,
    TurnMetricsProcessor,
    StartMetricsProcessor,
    LlmUsageProcessor,
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
    ScenarioSessionTagsRepository,
    ScenarioSessionMessageTagsRepository,
    BehaviorService,
    FillerTagService,
    BehaviorRepository,
    FillerTagRepository,
    ScenarioBehaviorInstructionService,
    ScenarioBehaviorInstructionRepository,
    ScenarioBehaviorInstructionBehaviorRepository,
    ScenarioSessionChatRepository,
    ScenarioSessionChatMessageRepository,
    ScenarioSessionContextProvider,
    ScenarioSessionChatService,
    CompetencyService,
    CompetencyRepository,
    CompetencyBehaviorRepository,
    AgentTestCaseService,
    AgentTestCaseRepository,
    ScenarioSessionEvaluationService,
    BehaviorTranslationRepository,
    ScenarioBehaviorInstructionTranslationRepository,
    BehaviorInstructionTranslationService,
    BehaviorTranslationService,
    ScenarioBehaviorInstructionTranslationService,
    OpenAIAutofillService,
    AnthropicAutofillService,
    ScenarioSessionRecordingRepository,
    ScenarioSessionRecordingService,
    ScenarioTranslationNotificationService,
    ScenarioTranslationGateway,
  ],
  exports: [
    LearnMessageProcessor,
    LearnEventProcessor,
    BehaviorInstructionProcessor,
    TurnMetricsProcessor,
    StartMetricsProcessor,
    LlmUsageProcessor,
    ScenarioSessionService,
    SimulationCreditsService,
    ScenarioSharedService,
    ScenarioService,
    ScenarioTenantService,
    ScenarioSessionRecordingService,
  ],
})
export class LearnModule {}
