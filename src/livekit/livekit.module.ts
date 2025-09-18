import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LiveKitService } from './service/livekit.service';
import { LiveKitController } from './controller/livekit.controller';
import { LivekitWebhookController } from './webhook/livekit-webhook.controller';
import { ParticipantJoinedHandler } from './webhook/handlers/participant-joined.handler';
import { RoomFinishedHandler } from './webhook/handlers/room-finished.handler';

@Module({
  imports: [ConfigModule],
  controllers: [LiveKitController, LivekitWebhookController],
  providers: [LiveKitService, ParticipantJoinedHandler, RoomFinishedHandler],
  exports: [LiveKitService],
})
export class LiveKitModule {}
