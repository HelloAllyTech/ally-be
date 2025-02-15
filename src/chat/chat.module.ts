import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Chat } from '../common/entities/chat.entity';
import { ChatRoom } from '../common/entities/chat-room.entity';
import { Message } from '../common/entities/message.entity';
import { User } from '../common/entities/user.entity';
import { ChatService } from './chat.service';
import { QueueModule } from '../queue/queue.module';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { UserModule } from '../user/user.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, Chat, ChatRoom]),
    UserModule,
    QueueModule,
    AiModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService],
})
export class ChatModule {}
