import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BroadcastMessageService } from './service/broadcast-message.service';
import { StreamFileProcessorService } from './service/stream-file-processor.service';
import { StreamTranscriptionService } from './service/stream-transcripton.service';
import { AwsModule } from '../aws/aws.module';
import { ChatAudioUploadsService } from './service/chat-audio-uploads.service';
import { ChatModule } from '../chat/chat.module';
import { AiModule } from '../ai/ai.module';
import { BrokerModule } from '../message-broker/broker.module';
import { ChatAudioUploads } from '../common/entities/chat-audio-uploads.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatAudioUploads]),
    AwsModule,
    forwardRef(() => ChatModule),
    AiModule,
    BrokerModule,
  ],
  providers: [
    StreamFileProcessorService,
    StreamTranscriptionService,
    BroadcastMessageService,
    ChatAudioUploadsService,
  ],
  exports: [
    StreamFileProcessorService,
    StreamTranscriptionService,
    BroadcastMessageService,
    ChatAudioUploadsService,
  ],
})
export class AudioModule {}
