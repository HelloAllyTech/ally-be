import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { validationSchema } from './config/env.validation';
import authConfig from './config/auth.config';
import { AppConfigModule } from './config/config.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ChatModule } from './chat/chat.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { UserModule } from './user/user.module';
import { QueueModule } from './queue/queue.module';
import { AiModule } from './ai/ai.module';
import { CustomExceptionFilter } from './exception/custom.exception.filter';
import { APP_FILTER } from '@nestjs/core';
import { RedisModule } from './redis/redis.module';
import { AudioIngestModule } from './audio-ingest/audio-ingest.module';
import { BrokerModule } from './message-broker/broker.module';
import { NotificationModule } from './notification/notification.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AnalyticsAgentModule } from './analytics-agent/analytics-agent.module';
import { AnalyticsSuggestionsModule } from './analytics-suggestions/analytics-suggestions.module';
import { BugHunterModule } from './bug-hunter/bug-hunter.module';
import { ExecutionContextMiddleware } from './common/execution/execution-context.middleware';
import { TenantModule } from './tenant/tenant.module';
import { CommonModule } from './common/common.module';
import { SettingsModule } from './settings/settings.module';
import { ReferenceDocumentModule } from './reference-document/reference-document.module';
import { AudioModule } from './audio/audio.module';
import { LiveKitModule } from './livekit/livekit.module';
import { LearnModule } from './learn/learn.module';
import { SessionEventModule } from './session-event/session-event.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { PlaceModule } from './place/place.module';
import { ScenarioPathModule } from './scenario-path/scenario-path.module';
import { LanguageModule } from './language/language.module';
import { ScenarioSessionReviewModule } from './scenario-session-review/scenario-session-review.module';
import { ScribeSessionReviewModule } from './scribe-session-review/scribe-session-review.module';
import { BadgeModule } from './badge/badge.module';
import { CommunityModule } from './community/community.module';
import { ScenarioCharacterModule } from './scenario-character/scenario-character.module';
import { PromptModule } from './prompt/prompt.module';
import { LlmModule } from './llm/llm.module';
import { ConversationalGuardrailsModule } from './conversational-guardrails/conversational-guardrails.module';
import { CaseModule } from './case/case.module';
import { TrackModule } from './track/track.module';
import { CohortModule } from './cohort/cohort.module';
import { ScenarioCoverImageLibraryModule } from './scenario-cover-image-library/scenario-cover-image-library.module';
import { ComfortAudioModule } from './comfort-audio/comfort-audio.module';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { ScenarioReportModule } from './scenario-report/scenario-report.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { AppVersionModule } from './app-version/app-version.module';
import { VoicePreviewModule } from './voice-preview/voice-preview.module';
import { LlmPreviewModule } from './llm-preview/llm-preview.module';
import { AuditModule } from './audit/audit.module';
import { CustomFieldsModule } from './custom-fields/custom-fields.module';
import { DynamicI18nModule } from './dynamic-i18n/dynamic-i18n.module';
import { TooltipModule } from './tooltip/tooltip.module';
import { RoleplaySessionLogsModule } from './roleplay-session-logs/roleplay-session-logs.module';
import { RoleplayStudioModule } from './roleplay-studio/roleplay-studio.module';
import { BlogModule } from './blog/blog.module';
import { LabModule } from './lab/lab.module';
import { ProductRoadmapModule } from './product-roadmap/product-roadmap.module';
import { LogsModule } from './logs/logs.module';
import { ChangelogModule } from './changelog/changelog.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [authConfig],
      validationSchema,
    }),
    AppConfigModule,
    DatabaseModule,
    AuthModule,
    ChatModule,
    HealthModule,
    EventEmitterModule.forRoot(),
    UserModule,
    QueueModule,
    AiModule,
    RedisModule,
    AudioIngestModule,
    BrokerModule,
    NotificationModule,
    RateLimitModule,
    AnalyticsModule,
    AnalyticsAgentModule,
    AnalyticsSuggestionsModule,
    BugHunterModule,
    TenantModule,
    CommonModule,
    SettingsModule,
    ReferenceDocumentModule,
    AudioModule,
    LearnModule,
    LiveKitModule,
    SessionEventModule,
    AuthorizationModule,
    PlaceModule,
    ScenarioPathModule,
    CaseModule,
    TrackModule,
    CohortModule,
    LanguageModule,
    ScenarioSessionReviewModule,
    ScribeSessionReviewModule,
    BadgeModule,
    CommunityModule,
    ScenarioCharacterModule,
    PromptModule,
    LlmModule,
    ConversationalGuardrailsModule,
    ScenarioCoverImageLibraryModule,
    ComfortAudioModule,
    KnowledgeBaseModule,
    WhatsAppModule,
    ScenarioReportModule,
    SchedulerModule,
    AppVersionModule,
    VoicePreviewModule,
    LlmPreviewModule,
    AuditModule,
    CustomFieldsModule,
    DynamicI18nModule,
    TooltipModule,
    RoleplaySessionLogsModule,
    RoleplayStudioModule,
    BlogModule,
    LabModule,
    ProductRoadmapModule,
    LogsModule,
    ChangelogModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_FILTER,
      useClass: CustomExceptionFilter,
    },
  ],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ExecutionContextMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
