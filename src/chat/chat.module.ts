import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Chat } from '../common/entities/chat.entity';
import { ChatRoom } from '../common/entities/chat-room.entity';
import { Message } from '../common/entities/message.entity';
import { ChatService } from './services/chat.service';
import { QueueModule } from '../queue/queue.module';
import { ChatController } from './controller/chat.controller';
import { ChatGateway } from './gateway/chat.gateway';
import { UserModule } from '../user/user.module';
import { AiModule } from '../ai/ai.module';
import { Feedback } from '../common/entities/feedback.entity';
import { FeedbackService } from './services/feedback.service';
import { CallDetails } from '../common/entities/call.details.entity';
import { ChatEventConsumer } from './event/chat.event.consumer';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, Chat, ChatRoom, Feedback, CallDetails]),
    UserModule,
    QueueModule,
    AiModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, FeedbackService, ChatEventConsumer],
  exports: [ChatService, FeedbackService, ChatGateway],
})
export class ChatModule {}
