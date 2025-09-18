import { Module } from '@nestjs/common';
import { SessionEventController } from './controller/session-event.controller';
import { SessionEventService } from './service/session-event.service';
import { SessionEvents } from './entity/session-events.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([SessionEvents])],
  controllers: [SessionEventController],
  providers: [SessionEventService],
  exports: [SessionEventService],
})
export class SessionEventModule {}
