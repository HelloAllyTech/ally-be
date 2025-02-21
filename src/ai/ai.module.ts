import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { DeepgramService } from './deepgram.service';

@Module({
  providers: [AiService, DeepgramService],
  exports: [AiService, DeepgramService],
})
export class AiModule {}
