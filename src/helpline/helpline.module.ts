import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { BrokerModule } from '../message-broker/broker.module';
import { NotificationModule } from '../notification/notification.module';
import { PromptModule } from '../prompt/prompt.module';
import { Preference } from '../settings/entity/preference.entity';
import { HelplineAdminController } from './controller/helpline-admin.controller';
import { HelplineGuestController } from './controller/helpline-guest.controller';
import { HelplinePublicController } from './controller/helpline-public.controller';
import { HelplineController } from './controller/helpline.controller';
import { HelplineChatEvent } from './entity/helpline-chat-event.entity';
import { HelplineChatSummary } from './entity/helpline-chat-summary.entity';
import { HelplineChat } from './entity/helpline-chat.entity';
import { HelplineListenerProfile } from './entity/helpline-listener-profile.entity';
import { HelplineMessage } from './entity/helpline-message.entity';
import { HelplineQaScore } from './entity/helpline-qa-score.entity';
import { HelplineRiskFlag } from './entity/helpline-risk-flag.entity';
import { HelplineRiskKeywordRule } from './entity/helpline-risk-keyword-rule.entity';
import { HelplineTalkerFeedback } from './entity/helpline-talker-feedback.entity';
import { HelplineTalker } from './entity/helpline-talker.entity';
import { HelplineChatGateway } from './gateway/helpline-chat.gateway';
import { HelplineSocketAuthService } from './gateway/helpline-socket-auth.service';
import {
  HelplineChatScopedGuard,
  HelplineEnabledGuard,
} from './guard/helpline-enabled.guard';
import { HelplineGuestGuard } from './guard/helpline-guest.guard';
import { HelplineChatRepository } from './repository/helpline-chat.repository';
import { HelplineMessageRepository } from './repository/helpline-message.repository';
import { HelplineAdminService } from './service/helpline-admin.service';
import { HelplineAlertService } from './service/helpline-alert.service';
import { HelplineChatLifecycleService } from './service/helpline-chat-lifecycle.service';
import { HelplineChatViewService } from './service/helpline-chat-view.service';
import { HelplineClaimService } from './service/helpline-claim.service';
import { HelplineConnectionService } from './service/helpline-connection.service';
import { HelplineContentCipher } from './service/helpline-content-cipher.service';
import { HelplineCopilotService } from './service/helpline-copilot.service';
import { HelplineEventService } from './service/helpline-event.service';
import { HelplineGuestTokenService } from './service/helpline-guest-token.service';
import { HelplineGuestService } from './service/helpline-guest.service';
import { HelplineLifecycleService } from './service/helpline-lifecycle.service';
import { HelplineListenerService } from './service/helpline-listener.service';
import { HelplineMessageWriter } from './service/helpline-message-writer.service';
import { HelplineMessageService } from './service/helpline-message.service';
import { HelplineNotifyService } from './service/helpline-notify.service';
import { HelplinePresenceService } from './service/helpline-presence.service';
import { HelplineProfileService } from './service/helpline-profile.service';
import { HelplineQueueService } from './service/helpline-queue.service';
import { HelplineRealtimeService } from './service/helpline-realtime.service';
import { HelplineRetentionService } from './service/helpline-retention.service';
import { HelplineRiskKeywordService } from './service/helpline-risk-keyword.service';
import { HelplineRiskService } from './service/helpline-risk.service';
import { HelplineSchedulerRegistrationService } from './service/helpline-scheduler-registration.service';
import { HelplineSessionService } from './service/helpline-session.service';
import { HelplineSettingsService } from './service/helpline-settings.service';
import { HelplineStaffDirectoryService } from './service/helpline-staff-directory.service';
import { HelplineSummaryService } from './service/helpline-summary.service';
import { HelplineTeamService } from './service/helpline-team.service';
import { HelplineTenantService } from './service/helpline-tenant.service';

/**
 * The copilot-supported text helpline (docs/text-helpline.md): anonymous web
 * talkers chat with trained human listeners.
 *
 * Global providers it leans on: AuthorizationModule (PermissionsService,
 * TenantFeatureService, GroupService), AuthModule (WebSocketAuthMiddleware),
 * RedisModule, AppConfigModule, and the global ThrottlerModule behind
 * `@RateLimit`. It imports nothing from the settings module beyond the
 * Preference entity (see HelplineSettingsService).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      HelplineTalker,
      HelplineChat,
      HelplineMessage,
      HelplineListenerProfile,
      HelplineRiskFlag,
      HelplineRiskKeywordRule,
      HelplineChatEvent,
      HelplineChatSummary,
      HelplineQaScore,
      HelplineTalkerFeedback,
      Preference,
    ]),
    // Own JwtService instance for the guest tokens; every call passes its
    // secret explicitly, so nothing here can sign with the access secret.
    JwtModule.register({}),
    BrokerModule,
    AiModule,
    PromptModule,
    NotificationModule,
  ],
  controllers: [
    HelplinePublicController,
    HelplineGuestController,
    HelplineController,
    HelplineAdminController,
  ],
  providers: [
    HelplineContentCipher,
    HelplineChatRepository,
    HelplineMessageRepository,
    HelplineTenantService,
    HelplineSettingsService,
    HelplineGuestTokenService,
    HelplinePresenceService,
    HelplineRealtimeService,
    HelplineEventService,
    HelplineProfileService,
    HelplineCopilotService,
    HelplineMessageWriter,
    HelplineRiskKeywordService,
    HelplineChatViewService,
    HelplineStaffDirectoryService,
    HelplineAlertService,
    HelplineQueueService,
    HelplineRiskService,
    HelplineSummaryService,
    HelplineNotifyService,
    HelplineChatLifecycleService,
    HelplineMessageService,
    HelplineClaimService,
    HelplineSessionService,
    HelplineRetentionService,
    HelplineGuestService,
    HelplineListenerService,
    HelplineTeamService,
    HelplineLifecycleService,
    HelplineConnectionService,
    HelplineSchedulerRegistrationService,
    HelplineAdminService,
    HelplineEnabledGuard,
    HelplineChatScopedGuard,
    HelplineGuestGuard,
    HelplineSocketAuthService,
    HelplineChatGateway,
  ],
  exports: [HelplineCopilotService, HelplineRiskService],
})
export class HelplineModule {}
