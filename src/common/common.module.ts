import { Global, Module } from '@nestjs/common';
import { CryptoService } from './service/crypto.service';
import { GoogleTranslationsService } from './service/google-translation.service';

@Global()
@Module({
  providers: [CryptoService, GoogleTranslationsService],
  exports: [CryptoService, GoogleTranslationsService],
})
export class CommonModule {}
