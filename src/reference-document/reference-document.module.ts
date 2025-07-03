import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReferenceDocument } from '../common/entities/reference-document.entity';
import { ReferenceDocumentController } from './controller/reference-document.controller';
import { ReferenceDocumentService } from './service/reference-document.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [TypeOrmModule.forFeature([ReferenceDocument]), AiModule],
  controllers: [ReferenceDocumentController],
  providers: [ReferenceDocumentService],
  exports: [ReferenceDocumentService],
})
export class ReferenceDocumentModule {}
