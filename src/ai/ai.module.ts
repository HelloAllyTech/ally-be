import { Module } from '@nestjs/common';
import { AiService } from './service/ai.service';
import { DeepgramService } from './service/deepgram.service';

@Module({
  providers: [AiService, DeepgramService],
  exports: [AiService, DeepgramService],
})
export class AiModule {}
