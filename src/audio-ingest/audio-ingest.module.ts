import { forwardRef, Module, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AudioIngestService } from './service/audio-ingest.service';
import { OzonetelService } from './service/ozonetel.service';
import { ExotelService } from './service/exotel.service';
import { AiModule } from '../ai/ai.module';
import { AudioIngestController } from './controller/audio-ingest.controller';
import { ChatModule } from '../chat/chat.module';
import { UserModule } from '../user/user.module';
import { AudioIngestGateway } from './gateway/audio.ingest.gateway';
import { ProviderFactory } from '../factory/provider.factory';
import { BrokerModule } from '../message-broker/broker.module';
import { AudioModule } from 'src/audio/audio.module';
import { CloudTelephonyGateway } from './gateway/cloud-telephony.gateway';

@Module({
  imports: [
    AiModule,
    ChatModule,
    UserModule,
    forwardRef(() => BrokerModule),
    AudioModule,
  ],
  providers: [
    AudioIngestService,
    OzonetelService,
    ExotelService,
    AudioIngestGateway,
    CloudTelephonyGateway,
    JwtService,
    ProviderFactory.getAudioIngestFactory(),
  ],
  controllers: [AudioIngestController],
})
export class AudioIngestModule implements OnModuleInit {
  constructor(private readonly cloudTelephonyGateway: CloudTelephonyGateway) {}
  onModuleInit() {
    this.cloudTelephonyGateway.subscribeToCloudTelephonyChatMessage();
  }
}
