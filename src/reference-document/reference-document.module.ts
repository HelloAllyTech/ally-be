import { Module } from '@nestjs/common';
import { ReferenceDocumentController } from './controller/reference-document.controller';
import { ReferenceDocumentService } from './service/reference-document.service';
import { AiModule } from '../ai/ai.module';
import { ReferenceDocumentRepository } from './repository/reference-document.repository';

@Module({
  imports: [AiModule],
  controllers: [ReferenceDocumentController],
  providers: [ReferenceDocumentService, ReferenceDocumentRepository],
  exports: [ReferenceDocumentService],
})
export class ReferenceDocumentModule {}
