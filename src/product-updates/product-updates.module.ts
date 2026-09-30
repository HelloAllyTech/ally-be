import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AwsModule } from 'src/aws/aws.module';
import { ChangelogModule } from 'src/changelog/changelog.module';
import { GithubModule } from 'src/github/github.module';
import { LlmAgentModule } from 'src/llm-agent/llm-agent.module';
import { PromptModule } from 'src/prompt/prompt.module';

import { ProductUpdatesController } from './controller/product-updates.controller';
import { ProductUpdateSource } from './entity/product-update-source.entity';
import { ProductUpdate } from './entity/product-update.entity';
import { ProductUpdateSourceRepository } from './repository/product-update-source.repository';
import { ProductUpdateRepository } from './repository/product-update.repository';
import { ProductUpdateConsolidationService } from './service/product-update-consolidation.service';
import { ProductUpdateDigestService } from './service/product-update-digest.service';
import { ProductUpdateIngestService } from './service/product-update-ingest.service';
import { ProductUpdateLivenessService } from './service/product-update-liveness.service';
import { ProductUpdatePipelineService } from './service/product-update-pipeline.service';
import { ProductUpdatesAiService } from './service/product-updates-ai.service';
import { ProductUpdatesSchedulerRegistrationService } from './service/product-updates-scheduler-registration.service';
import { ProductUpdatesService } from './service/product-updates.service';

/**
 * Feature-level product updates, built from `ally-changelog`'s per-merge
 * journal: one update per change a person would recognise, published to the
 * public changelog once live, and reported to the team in a daily email.
 *
 * AppConfigModule and RedisModule are global; everything else it reads is
 * imported here.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([ProductUpdate, ProductUpdateSource]),
    ChangelogModule,
    GithubModule,
    PromptModule,
    LlmAgentModule,
    AwsModule,
  ],
  controllers: [ProductUpdatesController],
  providers: [
    ProductUpdateRepository,
    ProductUpdateSourceRepository,
    ProductUpdateIngestService,
    ProductUpdatesAiService,
    ProductUpdateConsolidationService,
    ProductUpdateLivenessService,
    ProductUpdateDigestService,
    ProductUpdatePipelineService,
    ProductUpdatesService,
    ProductUpdatesSchedulerRegistrationService,
  ],
})
export class ProductUpdatesModule {}
