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
import { ReviewModule } from './review/review.module';
import { BadgeModule } from './badge/badge.module';

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
    LanguageModule,
    ReviewModule,
    BadgeModule,
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
