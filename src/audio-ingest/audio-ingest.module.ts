import { forwardRef, Module, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OzonetelService } from './service/ozonetel.service';
import { AiModule } from '../ai/ai.module';
import { ChatModule } from '../chat/chat.module';
import { UserModule } from '../user/user.module';
import { BrokerModule } from '../message-broker/broker.module';
import { AudioModule } from 'src/audio/audio.module';
import { CloudTelephonyGateway } from './gateway/cloud-telephony.gateway';
import { OzonetelWebhookController } from './webhook/ozonetel-webhook.controller';
import { CommonModule } from '../common/common.module';
import { CloudTelephonyService } from './service/cloud-telephony.service';
import { CloudTelephonyController } from './controller/cloud-telephony.controller';
import { CloudTelephonyRepository } from './repository/cloud-telephony.repository';
import { OzonetelController } from './controller/ozonetel.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CloudTelephonyIntegration } from './entity/cloud-telephony-integration.entity';
import { AudioRetryProducer } from './producer/audio-retry.producer';
import { AudioRetryConsumer } from './consumer/audio-retry.consumer';
import { AudioRetryDlqConsumer } from './consumer/audio-retry-dlq.consumer';
import { AwsModule } from '../aws/aws.module';

@Module({
  imports: [
    AiModule,
    ChatModule,
    UserModule,
    forwardRef(() => BrokerModule),
    AudioModule,
    CommonModule,
    TypeOrmModule.forFeature([CloudTelephonyIntegration]),
    AwsModule,
  ],
  providers: [
    CloudTelephonyGateway,
    JwtService,
    CloudTelephonyService,
    CloudTelephonyRepository,
    OzonetelService,
    AudioRetryProducer,
    AudioRetryConsumer,
    AudioRetryDlqConsumer,
  ],
  controllers: [
    OzonetelWebhookController,
    OzonetelController,
    CloudTelephonyController,
  ],
})
export class AudioIngestModule implements OnModuleInit {
  constructor(private readonly cloudTelephonyGateway: CloudTelephonyGateway) {}
  onModuleInit() {
    this.cloudTelephonyGateway.subscribeToCloudTelephonyChatMessage();
  }
}
