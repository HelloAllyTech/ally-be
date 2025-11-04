import { Global, Module } from '@nestjs/common';
import { CryptoService } from './service/crypto.service';

@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CommonModule {}
