import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiModule } from '../ai/ai.module';
import { AwsModule } from '../aws/aws.module';
import { Tenant } from '../tenant/entity/tenant.entity';
import {
  KbIngestConsumer,
  KbIngestDlqConsumer,
} from './consumer/kb-ingest.consumer';
import { KnowledgeBaseController } from './controller/knowledge-base.controller';
import { KbDocumentChunk } from './entity/kb-document-chunk.entity';
import { KbDocumentTenant } from './entity/kb-document-tenant.entity';
import { KbDocument } from './entity/kb-document.entity';
import { KbIngestProducer } from './producer/kb-ingest.producer';
import { KbDocumentChunkRepository } from './repository/kb-document-chunk.repository';
import { KbDocumentTenantRepository } from './repository/kb-document-tenant.repository';
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
    TypeOrmModule.forFeature([
      KbDocument,
      KbDocumentChunk,
      KbDocumentTenant,
      // Registered for one existence check when a document is targeted at organisations —
      // cheaper than importing the tenant module, which would couple two modules that
      // otherwise share nothing.
      Tenant,
    ]),
    AwsModule,
    AiModule,
  ],
  controllers: [KnowledgeBaseController],
  providers: [
    KbDocumentRepository,
    KbDocumentChunkRepository,
    KbDocumentTenantRepository,
    KbIngestProducer,
    KbIngestService,
    KnowledgeBaseService,
    KbIngestConsumer,
    KbIngestDlqConsumer,
  ],
  exports: [KnowledgeBaseService, KbDocumentChunkRepository],
})
export class KnowledgeBaseModule {}
