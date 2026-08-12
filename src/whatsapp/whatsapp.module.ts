import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { AwsModule } from '../aws/aws.module';
import { AppConfigService } from '../config/config.service';
import { KnowledgeBaseModule } from '../knowledge-base/knowledge-base.module';
import { PromptModule } from '../prompt/prompt.module';
import { RedisModule } from '../redis/redis.module';
import { GlobalSettings } from '../settings/entity/global-settings.entity';
import { GlobalSettingsRepository } from '../settings/repository/global-settings.repository';
import {
  WhatsAppInboundConsumer,
  WhatsAppInboundDlqConsumer,
} from './consumer/whatsapp-inbound.consumer';
import { WhatsAppAdminController } from './controller/whatsapp-admin.controller';
import { WhatsAppConversationController } from './controller/whatsapp-conversation.controller';
import { WhatsAppWebhookController } from './controller/whatsapp-webhook.controller';
import { WaContact } from './entity/wa-contact.entity';
import { WaConversation } from './entity/wa-conversation.entity';
import { WaKeywordTemplate } from './entity/wa-keyword-template.entity';
import { WaMessage } from './entity/wa-message.entity';
import { WaUnansweredQuestion } from './entity/wa-unanswered-question.entity';
import { WhatsAppInboundProducer } from './producer/whatsapp-inbound.producer';
import { MetaWhatsAppProvider } from './provider/meta-whatsapp.provider';
import { WaAnalyticsRepository } from './repository/wa-analytics.repository';
import { WhatsAppAdminService } from './service/whatsapp-admin.service';
import { WhatsAppConversationService } from './service/whatsapp-conversation.service';
import { WhatsAppInboundService } from './service/whatsapp-inbound.service';
import { WhatsAppRateLimitService } from './service/whatsapp-rate-limit.service';
import { WhatsAppRetentionService } from './service/whatsapp-retention.service';
import { WhatsAppSchedulerRegistrationService } from './service/whatsapp-scheduler-registration.service';
import { WhatsAppSettingsService } from './service/whatsapp-settings.service';
import { WhatsAppTemplateService } from './service/whatsapp-template.service';
import { WHATSAPP_PROVIDER } from './type/whatsapp-provider.interface';

/**
 * The WhatsApp Q&A bot.
 *
 * The provider is bound behind the `WHATSAPP_PROVIDER` token rather than injected directly, so
 * swapping Meta for a BSP is one factory change and nothing downstream — the consumer, templates,
 * consent and retrieval are all provider-agnostic.
 *
 * `GlobalSettingsRepository` is registered locally because SettingsModule does not export it. A
 * TypeORM repository is a stateless wrapper over the shared DataSource, so a second instance over
 * the same entity is safe; the alternative was widening SettingsModule's public surface for one
 * consumer.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      WaContact,
      WaConversation,
      WaMessage,
      WaKeywordTemplate,
      WaUnansweredQuestion,
      GlobalSettings,
    ]),
    AwsModule,
    AiModule,
    RedisModule,
    PromptModule,
    KnowledgeBaseModule,
  ],
  controllers: [
    WhatsAppWebhookController,
    WhatsAppAdminController,
    WhatsAppConversationController,
  ],
  providers: [
    GlobalSettingsRepository,
    WhatsAppSettingsService,
    WhatsAppTemplateService,
    WhatsAppRateLimitService,
    WhatsAppInboundProducer,
    WhatsAppInboundService,
    WhatsAppAdminService,
    WaAnalyticsRepository,
    WhatsAppConversationService,
    WhatsAppRetentionService,
    WhatsAppSchedulerRegistrationService,
    WhatsAppInboundConsumer,
    WhatsAppInboundDlqConsumer,
    MetaWhatsAppProvider,
    {
      provide: WHATSAPP_PROVIDER,
      // A factory rather than a plain class binding, so selecting a provider later is a branch here
      // instead of a change at every injection site. Meta is the only implementation today; an
      // unknown name falls back to it rather than leaving the token unbound, which would stop the
      // whole module from instantiating over a settings typo.
      useFactory: (config: AppConfigService, meta: MetaWhatsAppProvider) => {
        void config;
        return meta;
      },
      inject: [AppConfigService, MetaWhatsAppProvider],
    },
  ],
  exports: [WhatsAppSettingsService],
})
export class WhatsAppModule {}
