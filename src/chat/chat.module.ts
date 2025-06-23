import { forwardRef, Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Chat } from '../common/entities/chat.entity';
import { ChatRoom } from '../common/entities/chat-room.entity';
import { Message } from '../common/entities/message.entity';
import { ChatService } from './service/chat.service';
import { QueueModule } from '../queue/queue.module';
import { ChatController } from './controller/chat.controller';
import { ChatGateway } from './gateway/chat.gateway';
import { UserModule } from '../user/user.module';
import { AiModule } from '../ai/ai.module';
import { Feedback } from '../common/entities/feedback.entity';
import { FeedbackService } from './service/feedback.service';
import { CallDetails } from '../common/entities/call.details.entity';
import { ChatEventConsumer } from './event/chat.event.consumer';
import { BrokerModule } from '../message-broker/broker.module';
import { SettingsModule } from '../settings/settings.module';
import { MultiSpeakerAudioService } from './service/multi-speaker-audio.service';
import { MicrophoneChatGateway } from './gateway/microphone-chat.gateway';
@Module({
  imports: [
    TypeOrmModule.forFeature([Message, Chat, ChatRoom, Feedback, CallDetails]),
    UserModule,
    QueueModule,
    AiModule,
    SettingsModule,
    forwardRef(() => BrokerModule),
  ],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatGateway,
    MicrophoneChatGateway,
    FeedbackService,
    ChatEventConsumer,
    MultiSpeakerAudioService,
  ],
  exports: [
    ChatService,
    FeedbackService,
    ChatGateway,
    MultiSpeakerAudioService,
  ],
})
export class ChatModule implements OnModuleInit {
  constructor(
    private readonly chatGateway: ChatGateway,
    private readonly microphoneChatGateway: MicrophoneChatGateway,
  ) {}
  onModuleInit() {
    this.chatGateway.subscribeToWebRTCChatMessage();
    this.microphoneChatGateway.subscribeToMicrophoneChatMessage();
  }
}
