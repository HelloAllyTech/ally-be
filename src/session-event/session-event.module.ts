import { Module } from '@nestjs/common';
import { SessionEventController } from './controller/session-event.controller';
import { SessionEventService } from './service/session-event.service';
import { SessionEvents } from './entity/session-events.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionEventRepository } from './repository/session-event.repository';

@Module({
  imports: [TypeOrmModule.forFeature([SessionEvents])],
  controllers: [SessionEventController],
  providers: [SessionEventService, SessionEventRepository],
  exports: [SessionEventService],
})
export class SessionEventModule {}
