import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LiveKitService } from './service/livekit.service';
import { LiveKitController } from './controller/livekit.controller';
import { LivekitWebhookController } from './webhook/livekit-webhook.controller';
import { ParticipantJoinedHandler } from './webhook/handlers/participant-joined.handler';
import { RoomFinishedHandler } from './webhook/handlers/room-finished.handler';
import { EgressStartedHandler } from './webhook/handlers/egress-started.handler';
import { LearnModule } from 'src/learn/learn.module';

@Module({
  imports: [ConfigModule, forwardRef(() => LearnModule)],
  controllers: [LiveKitController, LivekitWebhookController],
  providers: [
    LiveKitService,
    ParticipantJoinedHandler,
    RoomFinishedHandler,
    EgressStartedHandler,
  ],
  exports: [LiveKitService],
})
export class LiveKitModule {}
