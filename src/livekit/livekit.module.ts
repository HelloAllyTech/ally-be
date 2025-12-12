import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LiveKitService } from './service/livekit.service';
import { LiveKitController } from './controller/livekit.controller';
import { LivekitWebhookController } from './webhook/livekit-webhook.controller';
import { ParticipantJoinedHandler } from './webhook/handlers/participant-joined.handler';
import { RoomFinishedHandler } from './webhook/handlers/room-finished.handler';
import { LearnModule } from 'src/learn/learn.module';
import { UserModule } from 'src/user/user.module';

@Module({
  imports: [
    ConfigModule,
    forwardRef(() => LearnModule),
    forwardRef(() => UserModule),
  ],
  controllers: [LiveKitController, LivekitWebhookController],
  providers: [LiveKitService, ParticipantJoinedHandler, RoomFinishedHandler],
  exports: [LiveKitService],
})
export class LiveKitModule {}
