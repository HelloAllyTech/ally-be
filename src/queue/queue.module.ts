import { forwardRef, Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueueEntry } from '../common/entities/queue.entity';
import { QueueController } from './queue.controller';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([QueueEntry]),
    forwardRef(() => ChatModule),
  ],
  providers: [QueueService],
  exports: [QueueService],
  controllers: [QueueController],
})
export class QueueModule {}
