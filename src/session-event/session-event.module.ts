import { Module } from '@nestjs/common';
import { SessionEventController } from './controller/session-event.controller';
import { SessionEventService } from './service/session-event.service';
import { SessionEventRepository } from './repository/session-event.repository';

@Module({
  controllers: [SessionEventController],
  providers: [SessionEventService, SessionEventRepository],
  exports: [SessionEventService],
})
export class SessionEventModule {}
