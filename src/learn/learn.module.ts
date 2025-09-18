import { forwardRef, Module } from '@nestjs/common';
import { LearnController } from './controller/learn.controller';
import { ScenarioService } from './service/scenario.service';
import { Scenarios } from './entity/scenarios.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScenarioSessionService } from './service/scenario-session.service';
import { ScenarioSessions } from './entity/scenario-sessions.entity';
import { ScenarioSessionRepository } from './repository/scenario-session.repository';
import { ScenarioSessionMessagesRepository } from './repository/scenario-session-messages.repository';
import { LiveKitModule } from 'src/livekit/livekit.module';
import { ScenarioSessionFeedbacks } from './entity/scenario-session-feedbacks.entity';
import { ScenarioEvents } from './entity/scenario-events.entity';
import { SessionEventModule } from 'src/session-event/session-event.module';
import { AiModule } from 'src/ai/ai.module';
import { ScenarioSessionMessages } from './entity/scenario-session-messages.entity';
import { LearnMessageAndEventConsumer } from './consumer/learn-message-and-event.consumer';
import { LearnMessageProcessor } from './processor/learn-message.processor';
import { LearnEventProcessor } from './processor/learn-event.processor';
import { ScenarioSessionEvents } from './entity/scenario-session-events.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Scenarios,
      ScenarioSessions,
      ScenarioEvents,
      ScenarioSessionFeedbacks,
      ScenarioSessionMessages,
      ScenarioSessionEvents,
    ]),
    LiveKitModule,
    SessionEventModule,
    forwardRef(() => AiModule),
  ],
  controllers: [LearnController],
  providers: [
    ScenarioService,
    ScenarioSessionService,
    ScenarioSessionRepository,
    ScenarioSessionMessagesRepository,
    LearnMessageAndEventConsumer,
    LearnMessageProcessor,
    LearnEventProcessor,
  ],
  exports: [LearnMessageProcessor, LearnEventProcessor],
})
export class LearnModule {}
