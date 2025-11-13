import { forwardRef, Module } from '@nestjs/common';
import { LearnController } from './controller/learn.controller';
import { ScenarioService } from './service/scenario.service';
import { ScenarioSessionService } from './service/scenario-session.service';
import { ScenarioSessionRepository } from './repository/scenario-session.repository';
import { ScenarioSessionMessagesRepository } from './repository/scenario-session-messages.repository';
import { LiveKitModule } from 'src/livekit/livekit.module';
import { SessionEventModule } from 'src/session-event/session-event.module';
import { AiModule } from 'src/ai/ai.module';
import { LearnMessageAndEventConsumer } from './consumer/learn-message-and-event.consumer';
import { LearnMessageProcessor } from './processor/learn-message.processor';
import { LearnEventProcessor } from './processor/learn-event.processor';
import { ScenariosRepository } from './repository/scenario.repository';
import { ScenarioVoicesRepository } from './repository/scenario-voices.repository';
import { SimulationCreditsController } from './controller/simulation-credits.controller';
import { SimulationCreditsService } from './service/simulation-credits.service';
import { SimulationCreditsRepository } from './repository/simulation-credits.repository';
import { PermissionValidator } from 'src/authorization/service/permission-validator.service';
import { UserModule } from 'src/user/user.module';
import { AwsModule } from 'src/aws/aws.module';
import { ScenarioEventsRepository } from './repository/scenario-events.repository';
import { ScenarioSessionFeedbacksRepository } from './repository/scenario-session-feedbacks.repository';

@Module({
  imports: [
    forwardRef(() => LiveKitModule),
    SessionEventModule,
    forwardRef(() => AiModule),
    forwardRef(() => UserModule),
    AwsModule,
  ],
  controllers: [LearnController, SimulationCreditsController],
  providers: [
    ScenarioService,
    ScenarioSessionService,
    ScenarioSessionRepository,
    ScenarioSessionMessagesRepository,
    ScenariosRepository,
    LearnMessageAndEventConsumer,
    LearnMessageProcessor,
    LearnEventProcessor,
    ScenarioVoicesRepository,
    SimulationCreditsService,
    SimulationCreditsRepository,
    PermissionValidator,
    ScenarioEventsRepository,
    ScenarioSessionFeedbacksRepository,
  ],
  exports: [
    LearnMessageProcessor,
    LearnEventProcessor,
    ScenarioSessionService,
    SimulationCreditsService,
  ],
})
export class LearnModule {}
