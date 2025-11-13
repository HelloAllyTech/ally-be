import { forwardRef, Module } from '@nestjs/common';
import { BroadcastMessageService } from './service/broadcast-message.service';
import { StreamFileProcessorService } from './service/stream-file-processor.service';
import { StreamTranscriptionService } from './service/stream-transcripton.service';
import { AwsModule } from '../aws/aws.module';
import { ChatAudioUploadsService } from './service/chat-audio-uploads.service';
import { ChatModule } from '../chat/chat.module';
import { AiModule } from '../ai/ai.module';
import { BrokerModule } from '../message-broker/broker.module';
import { ChatAudioUploadRepository } from './repository/chat-audio-upload.repository';

@Module({
  imports: [AwsModule, forwardRef(() => ChatModule), AiModule, BrokerModule],
  providers: [
    StreamFileProcessorService,
    StreamTranscriptionService,
    BroadcastMessageService,
    ChatAudioUploadsService,
    ChatAudioUploadRepository,
  ],
  exports: [
    StreamFileProcessorService,
    StreamTranscriptionService,
    BroadcastMessageService,
    ChatAudioUploadsService,
  ],
})
export class AudioModule {}
