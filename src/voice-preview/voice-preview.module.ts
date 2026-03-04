import { Module } from '@nestjs/common';
import { AppConfigModule } from 'src/config/config.module';
import { LearnModule } from 'src/learn/learn.module';
import { VoicePreviewController } from './voice-preview.controller';
import { VoicePreviewService } from './voice-preview.service';
import { TTSProviderFactory } from './providers/tts-provider.factory';

@Module({
  imports: [AppConfigModule, LearnModule],
  controllers: [VoicePreviewController],
  providers: [VoicePreviewService, TTSProviderFactory],
})
export class VoicePreviewModule {}
