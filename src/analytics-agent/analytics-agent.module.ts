import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/config.module';
import { AnalyticsAgentController } from './controller/analytics-agent.controller';
import { AnalyticsAgentService } from './service/analytics-agent.service';
import { SchemaCatalogService } from './service/schema-catalog.service';
import { SqlExecutorService } from './service/sql-executor.service';

/**
 * The Analytics Agent — natural-language questions over the analytics tables.
 *
 * A module of its own rather than more files under `analytics/`: that module is
 * ~40 providers of fixed, reviewed aggregates, and this one is a single feature
 * whose whole point is that it writes its own queries. Keeping the trust
 * boundary (allowlist, guard, read-only executor) in one small module means the
 * files a reviewer has to read to convince themselves the feature is safe are
 * exactly the files in this directory.
 *
 * No TypeORM entities: the agent reads existing tables through the shared
 * DataSource and stores nothing. Conversation state lives in the browser.
 */
@Module({
  imports: [AppConfigModule],
  controllers: [AnalyticsAgentController],
  providers: [AnalyticsAgentService, SchemaCatalogService, SqlExecutorService],
})
export class AnalyticsAgentModule {}
