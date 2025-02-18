import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Chat } from '../common/entities/chat.entity';
import { ChatRoom } from '../common/entities/chat-room.entity';
import { Message } from '../common/entities/message.entity';
import { ChatService } from './chat.service';
import { QueueModule } from '../queue/queue.module';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { UserModule } from '../user/user.module';
import { AiModule } from '../ai/ai.module';
import { Feedback } from '../common/entities/feedback.entity';
import { FeedbackService } from './services/feedback.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, Chat, ChatRoom, Feedback]),
    UserModule,
    QueueModule,
    AiModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, FeedbackService],
  exports: [ChatService, FeedbackService],
})
export class ChatModule {}
