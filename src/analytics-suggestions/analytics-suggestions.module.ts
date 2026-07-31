import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfigModule } from 'src/config/config.module';
import { AnalyticsModule } from 'src/analytics/analytics.module';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';
import { PromptModule } from 'src/prompt/prompt.module';
import { ProductRoadmapModule } from 'src/product-roadmap/product-roadmap.module';

import { AnalyticsSuggestionsController } from './controller/analytics-suggestions.controller';
import { AnalyticsSuggestion } from './entity/analytics-suggestion.entity';
import { AnalyticsSuggestionRepository } from './repository/analytics-suggestion.repository';
import { AnalyticsSuggestionsAiService } from './service/analytics-suggestions-ai.service';
import { AnalyticsSuggestionsPayloadService } from './service/analytics-suggestions-payload.service';
import { AnalyticsSuggestionsService } from './service/analytics-suggestions.service';

/**
 * Analytics Suggestions — "read the platform's own numbers and tell me what to
 * build next", reviewed card by card and filed onto the product roadmap.
 *
 * A module of its own rather than more files under `analytics/`, following the
 * Analytics Agent precedent: that module is ~45 providers of fixed, reviewed
 * aggregates, and this is one feature that composes them, calls a model, and
 * writes into another module's backlog. The three things a reviewer must check to
 * trust it — what data leaves the platform, what validation stands between the
 * model and stored taxonomy, and what filing an accepted suggestion actually does
 * — are all in this directory.
 *
 * Its dependencies say what it is:
 *  - AnalyticsModule for the fifteen aggregate services, so the model reads the
 *    platform through exactly the same code the dashboard does;
 *  - ProductRoadmapModule for the create path and the live goal taxonomy;
 *  - PromptModule so the system prompt stays admin-editable;
 *  - LlmUsageModule because an un-metered LLM call is a billing blind spot.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AnalyticsSuggestion]),
    AppConfigModule,
    AnalyticsModule,
    ProductRoadmapModule,
    PromptModule,
    LlmUsageModule,
  ],
  controllers: [AnalyticsSuggestionsController],
  providers: [
    AnalyticsSuggestionRepository,
    AnalyticsSuggestionsPayloadService,
    AnalyticsSuggestionsAiService,
    AnalyticsSuggestionsService,
  ],
})
export class AnalyticsSuggestionsModule {}
