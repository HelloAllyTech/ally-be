import { forwardRef, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Chat } from './entity/chat.entity';
import { ChatSummaryAttempt } from './entity/chat-summary-attempt.entity';
import { Message } from './entity/message.entity';
import { ChatService } from './service/chat.service';
import { ChatSummaryService } from './service/chat-summary.service';
import { AudioUploadService } from './service/audio-upload.service';
import { VoiceNoteService } from './service/voice-note.service';
import { ChatController } from './controller/chat.controller';
import { AudioUploadController } from './controller/audio-upload.controller';
import { UserModule } from '../user/user.module';
import { Feedback } from './entity/feedback.entity';
import { FeedbackService } from './service/feedback.service';
import { CallDetails } from './entity/call.details.entity';
import { ChatEventConsumer } from './event/chat.event.consumer';
import { BrokerModule } from '../message-broker/broker.module';
import { SettingsModule } from '../settings/settings.module';
import { MicrophoneChatGateway } from './gateway/microphone-chat.gateway';
import { ChatAiService } from './service/chat-ai-service';
import { JwtService } from '@nestjs/jwt';
import { AudioModule } from '../audio/audio.module';
import { AiModule } from '../ai/ai.module';

import { AwsModule } from 'src/aws/aws.module';
import { NotificationModule } from '../notification/notification.module';
import { ChatRepository } from './repository/chat.repository';
import { SummaryFeedback } from './entity/summary-feedback.entity';
import { SummaryFeedbackRepository } from './repository/summary-feedback.repository';
import { MessageRepository } from './repository/message.repository';
import { CallDetailsRepository } from './repository/call-details.repository';
import { AudioUploadConsumer } from './consumer/audio-upload.consumer';
import { AudioUploadDlqConsumer } from './consumer/audio-upload-dlq.consumer';
import { MessageService } from './service/message.service';
import { CallDetailsService } from './service/call-details.service';
import { CallLogService } from './service/call-log.service';
import { AiChatIntegrationService } from './service/ai-chat-integration.service';
import { ChatFeedbackService } from './service/chat-feedback.service';
import { ChatTranscriptService } from './service/chat-transcript.service';
import { ChatSummaryAttemptService } from './service/chat-summary-attempt.service';
import { ChatSharedService } from './service/chat-shared.service';
import { ChatSchedulerRegistrationService } from './service/chat-scheduler-registration.service';
import { ScribeSessionReviewModule } from 'src/scribe-session-review/scribe-session-review.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, Feedback, CallDetails, SummaryFeedback]),
    TypeOrmModule.forFeature([Chat, ChatRepository, ChatSummaryAttempt]),
    UserModule,
    forwardRef(() => AiModule),
    SettingsModule,
    forwardRef(() => BrokerModule),
    forwardRef(() => AudioModule),
    AwsModule,
    NotificationModule,
    ScribeSessionReviewModule,
    forwardRef(() => CustomFieldsModule),
  ],
  controllers: [ChatController, AudioUploadController],
  providers: [
    ChatService,
    ChatSummaryService,
    AudioUploadService,
    VoiceNoteService,
    MicrophoneChatGateway,
    FeedbackService,
    ChatEventConsumer,
    ChatAiService,
    JwtService,
    ChatRepository,
    SummaryFeedbackRepository,
    MessageRepository,
    MessageService,
    CallDetailsRepository,
    CallDetailsService,
    CallLogService,
    AiChatIntegrationService,
    ChatFeedbackService,
    AudioUploadConsumer,
    AudioUploadDlqConsumer,
    ChatTranscriptService,
    ChatSummaryAttemptService,
    ChatSharedService,
    ChatSchedulerRegistrationService,
  ],
  exports: [
    ChatService,
    MessageService,
    CallDetailsService,
    CallLogService,
    AiChatIntegrationService,
    ChatFeedbackService,
    FeedbackService,
    ChatAiService,
    AudioUploadService,
    ChatTranscriptService,
    ChatSharedService,
  ],
})
export class ChatModule implements OnModuleInit {
  constructor(private readonly microphoneChatGateway: MicrophoneChatGateway) {}
  onModuleInit() {
    this.microphoneChatGateway.subscribeToMicrophoneChatMessage();
  }
}
