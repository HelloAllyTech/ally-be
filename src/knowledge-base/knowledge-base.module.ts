import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { AwsModule } from '../aws/aws.module';
import {
  KbIngestConsumer,
  KbIngestDlqConsumer,
} from './consumer/kb-ingest.consumer';
import { KnowledgeBaseController } from './controller/knowledge-base.controller';
import { KbDocumentChunk } from './entity/kb-document-chunk.entity';
import { KbDocument } from './entity/kb-document.entity';
import { KbIngestProducer } from './producer/kb-ingest.producer';
import { KbDocumentChunkRepository } from './repository/kb-document-chunk.repository';
import { KbDocumentRepository } from './repository/kb-document.repository';
import { KbIngestService } from './service/kb-ingest.service';
import { KnowledgeBaseService } from './service/knowledge-base.service';

/**
 * The WhatsApp Q&A bot's knowledge corpus.
 *
 * Postgres here is the system of record; ally-ai's KnowledgeChunk collection is a derived index.
 * Exports the two services so the whatsapp module can retrieve and resolve citations without
 * reaching into these repositories directly.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([KbDocument, KbDocumentChunk]),
    AwsModule,
    AiModule,
  ],
  controllers: [KnowledgeBaseController],
  providers: [
    KbDocumentRepository,
    KbDocumentChunkRepository,
    KbIngestProducer,
    KbIngestService,
    KnowledgeBaseService,
    KbIngestConsumer,
    KbIngestDlqConsumer,
  ],
  exports: [KnowledgeBaseService, KbDocumentChunkRepository],
})
export class KnowledgeBaseModule {}
