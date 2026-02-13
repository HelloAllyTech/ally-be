import { Global, Module } from '@nestjs/common';
import { CryptoService } from './service/crypto.service';
import { GoogleTranslationsService } from './service/google-translation.service';
import { OpenAITranslationsService } from './service/openai-translation.service';
import { PromptModule } from 'src/prompt/prompt.module';

@Global()
@Module({
  imports: [PromptModule],
  providers: [
    CryptoService,
    GoogleTranslationsService,
    OpenAITranslationsService,
  ],
  exports: [
    CryptoService,
    GoogleTranslationsService,
    OpenAITranslationsService,
  ],
})
export class CommonModule {}
