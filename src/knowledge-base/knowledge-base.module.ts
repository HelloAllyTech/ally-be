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
import { KbRetrievalPassage } from './entity/kb-retrieval-passage.entity';
import { KbRetrieval } from './entity/kb-retrieval.entity';
import { KbIngestProducer } from './producer/kb-ingest.producer';
import { KbDocumentChunkRepository } from './repository/kb-document-chunk.repository';
import { KbDocumentRepository } from './repository/kb-document.repository';
import { KbRetrievalRepository } from './repository/kb-retrieval.repository';
import { KbIngestService } from './service/kb-ingest.service';
import { KnowledgeBaseService } from './service/knowledge-base.service';

/**
 * The knowledge corpora — the WhatsApp Q&A bot's, and the character library's.
 *
 * One pipeline; a consumer declares its `corpus` and that resolves to its own Weaviate
 * collection. Postgres here is the system of record and every vector index is derived from it.
 *
 * Exports the two services so the whatsapp and scenario-character modules can retrieve and
 * resolve citations without reaching into these repositories directly.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      KbDocument,
      KbDocumentChunk,
      KbRetrieval,
      KbRetrievalPassage,
    ]),
    AwsModule,
    AiModule,
  ],
  controllers: [KnowledgeBaseController],
  providers: [
    KbDocumentRepository,
    KbDocumentChunkRepository,
    KbRetrievalRepository,
    KbIngestProducer,
    KbIngestService,
    KnowledgeBaseService,
    KbIngestConsumer,
    KbIngestDlqConsumer,
  ],
  exports: [KnowledgeBaseService, KbDocumentChunkRepository],
})
export class KnowledgeBaseModule {}
