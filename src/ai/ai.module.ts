import { Module } from '@nestjs/common';
import { AiService } from './service/ai.service';
import { DeepgramService } from './service/deepgram.service';
import { TranscriptionService } from './service/transcription.service';
@Module({
  providers: [
    AiService,
    { provide: 'transcriptionService', useClass: DeepgramService },
    TranscriptionService,
  ],
  exports: [AiService, TranscriptionService],
})
export class AiModule {}
