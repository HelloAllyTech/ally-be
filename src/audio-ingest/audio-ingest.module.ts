import { Module } from '@nestjs/common';
import { AudioIngestService } from './service/audio-ingest.service';
import { OzonetelService } from './service/ozonetel.service';
import { AiModule } from '../ai/ai.module';
import { AudioIngestController } from './controller/audio-ingest.controller';
import { ChatModule } from '../chat/chat.module';
import { AudioIngestGateway } from './gateway/audio.ingest.gateway';
@Module({
  imports: [AiModule, ChatModule],
  providers: [AudioIngestService, OzonetelService, AudioIngestGateway],
  controllers: [AudioIngestController],
})
export class AudioIngestModule {}
