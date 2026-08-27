import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppConfigModule } from 'src/config/config.module';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';
import { PromptModule } from 'src/prompt/prompt.module';
import { BugFinding } from 'src/bug-hunter/entity/bug-finding.entity';
import { BugFindingRepository } from 'src/bug-hunter/repository/bug-finding.repository';
import { AnalyticsSuggestion } from 'src/analytics-suggestions/entity/analytics-suggestion.entity';
import { RoadmapProductGoal } from 'src/product-roadmap/entity/roadmap-product-goal.entity';
import { RoadmapProductGoalRepository } from 'src/product-roadmap/repository/roadmap-taxonomy.repository';

import { UxSignalsController } from './controller/ux-signals.controller';
import { UxSignalScan } from './entity/ux-signal-scan.entity';
import { PosthogQueryService } from './service/posthog-query.service';
import { UxSignalDetectorService } from './service/ux-signal-detector.service';
import { UxSignalWriterService } from './service/ux-signal-writer.service';
import { UxSignalsAiService } from './service/ux-signals-ai.service';
import { UxSignalsSchedulerRegistrationService } from './service/ux-signals-scheduler-registration.service';
import { UxSignalsService } from './service/ux-signals.service';

/**
 * UX Signals — "read how people actually experience the product, and file what
 * looks broken or lossy where someone will see it".
 *
 * The platform's PostHog integration was write-only: the frontends captured
 * events and nothing ever read them back. This module is the reader, and it
 * closes the loop into the two review queues that already exist rather than
 * building a third one.
 *
 * ## Why it owns no review UI
 * A scan produces two kinds of artefact and files each where its audience already
 * works: bug-shaped items become `bug_findings` rows in the Bug Hunter queue,
 * improvement-shaped ones become pending `analytics_suggestions` reviewed in the
 * Analytics Suggestions tab. Neither destination is modified — the existing
 * approve and accept/reject gates are the gates. The pipeline proposes; people
 * decide, and nothing here can dispatch a fix session or file a roadmap item.
 *
 * ## Why it writes through raw repositories
 * `BugFindingRepository` and `RoadmapProductGoalRepository` are provided here
 * rather than imported from their owning modules. Both construct themselves from
 * the DataSource, so this costs nothing, and it keeps the module graph acyclic:
 * BugHunterModule registers `BugFinding` in `forFeature` precisely so other
 * domains can write findings without depending on it (see
 * RoadmapOpportunityService.create, which files a finding the same way). A graph
 * where every producer of findings imports the module that consumes them is how
 * this codebase has hit circular-import DI failures before.
 *
 * ## Dependencies say what it is
 *  - AppConfigModule for the PostHog query credential;
 *  - PromptModule so the triage system prompt stays admin-editable;
 *  - LlmUsageModule because an un-metered LLM call is a billing blind spot.
 *
 * Note what is absent: AnalyticsModule. This module reads *telemetry* about how
 * the product is used, which is a different question from the platform analytics
 * about how counsellors perform, and the two deliberately do not share a data
 * path.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      UxSignalScan,
      BugFinding,
      AnalyticsSuggestion,
      RoadmapProductGoal,
    ]),
    AppConfigModule,
    PromptModule,
    LlmUsageModule,
  ],
  controllers: [UxSignalsController],
  providers: [
    PosthogQueryService,
    UxSignalDetectorService,
    UxSignalsAiService,
    UxSignalWriterService,
    UxSignalsService,
    UxSignalsSchedulerRegistrationService,
    BugFindingRepository,
    RoadmapProductGoalRepository,
  ],
})
export class UxSignalsModule {}
