import { forwardRef, Module } from '@nestjs/common';
import { QueueService } from './service/queue.service';
import { QueueController } from './controller/queue.controller';
import { ChatModule } from '../chat/chat.module';
import { QueueRepository } from './repository/queue.repository';

@Module({
  imports: [forwardRef(() => ChatModule)],
  providers: [QueueService, QueueRepository],
  exports: [QueueService],
  controllers: [QueueController],
})
export class QueueModule {}
