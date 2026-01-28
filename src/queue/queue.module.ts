import { Module } from '@nestjs/common';
import { QueueService } from './service/queue.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueueEntry } from './entity/queue-entry.entity';
import { QueueController } from './controller/queue.controller';
import { QueueRepository } from './repository/queue.repository';

@Module({
  imports: [TypeOrmModule.forFeature([QueueEntry])],
  providers: [QueueService, QueueRepository],
  exports: [QueueService],
  controllers: [QueueController],
})
export class QueueModule {}
