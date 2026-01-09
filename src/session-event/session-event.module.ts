import { forwardRef, Module } from '@nestjs/common';
import { SessionEventController } from './controller/session-event.controller';
import { SessionEventService } from './service/session-event.service';
import { SessionEvents } from './entity/session-events.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionEventRepository } from './repository/session-event.repository';
import { LearnModule } from 'src/learn/learn.module';
import { CommonModule } from 'src/common/common.module';
import { LanguageModule } from 'src/language/language.module';
import { SessionEventTranslationsRepository } from './repository/session-event-translation.repository';
import { SessionEventTranslationService } from './service/session-event-translation.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SessionEvents]),
    forwardRef(() => CommonModule),
    forwardRef(() => LanguageModule),
    forwardRef(() => LearnModule),
  ],
  controllers: [SessionEventController],
  providers: [
    SessionEventService,
    SessionEventRepository,
    SessionEventTranslationsRepository,
    SessionEventTranslationService,
  ],
  exports: [SessionEventService, SessionEventTranslationService],
})
export class SessionEventModule {}
