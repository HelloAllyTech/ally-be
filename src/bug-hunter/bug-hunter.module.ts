import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { NotificationModule } from 'src/notification/notification.module';
import { LogsModule } from 'src/logs/logs.module';
import { PromptModule } from 'src/prompt/prompt.module';
import { LlmUsageModule } from 'src/analytics/llm-usage.module';
import { RoadmapOpportunity } from 'src/product-roadmap/entity/roadmap-opportunity.entity';

import { BugHunterController } from './controller/bug-hunter.controller';
import { BugHunterPipelineController } from './controller/bug-hunter-pipeline.controller';
import { BugHuntRun } from './entity/bug-hunt-run.entity';
import { BugHuntEvent } from './entity/bug-hunt-event.entity';
import { BugHunterSettings } from './entity/bug-hunter-settings.entity';
import { BugFinding } from './entity/bug-finding.entity';
import { BugHunterNotification } from './entity/bug-hunter-notification.entity';
import { BugHuntRunRepository } from './repository/bug-hunt-run.repository';
import { BugHuntEventRepository } from './repository/bug-hunt-event.repository';
import { BugHunterSettingsRepository } from './repository/bug-hunter-settings.repository';
import { BugFindingRepository } from './repository/bug-finding.repository';
import { BugHunterNotificationRepository } from './repository/bug-hunter-notification.repository';
import { BugHuntSweepService } from './service/bug-hunt-sweep.service';
import { BugHunterService } from './service/bug-hunter.service';
import { BugFindingService } from './service/bug-finding.service';
import { BugHunterFinderDataService } from './service/bug-hunter-finder-data.service';
import { BugFixSessionService } from './service/bug-fix-session.service';
import { BugHunterRepoClassifierService } from './service/bug-hunter-repo-classifier.service';
import { GithubActionsService } from './service/github-actions.service';
import { BugHunterNotificationService } from './service/bug-hunter-notification.service';
import { BugFixSessionSchedulerRegistrationService } from './service/bug-fix-session-scheduler-registration.service';

/**
 * Bug Hunter: the kill switch, the comprehensive findings table, run history,
 * and event transcript for the autonomous find-and-fix agent. Off by default
 * — see the introducing migration and `BugHunterSettings`.
 *
 * This module owns none of the actual bug-finding/fixing logic: that lives in
 * the external `.claude/workflows/bug-hunt.mjs` Claude Code pipeline, which
 * calls this module's HTTP surface to check the switch, open/close runs,
 * persist/transition findings, and report each pipeline step. Keeping the two
 * separate means this module has no dependency on Claude Code tooling and can
 * be tested like any other NestJS module.
 *
 * No import of ProductRoadmapModule: `BugFinding` is registered here for
 * `@InjectRepository` in RoadmapOpportunityService too (see its `create()`),
 * the same cross-domain-entity pattern that file already uses for `User` —
 * importing this whole module there would risk the circular-import trap this
 * codebase has been bitten by before (see ally-be/CLAUDE.md's gotchas). The
 * same trick runs in the other direction too: `RoadmapOpportunity` is
 * registered here, just the entity and not ProductRoadmapModule, so
 * `BugFixSessionService` can release the linked roadmap opportunity the
 * moment a reported bug's finding merges (see its
 * `releaseLinkedRoadmapOpportunity`).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      BugHuntRun,
      BugHuntEvent,
      BugHunterSettings,
      BugFinding,
      BugHunterNotification,
      RoadmapOpportunity,
    ]),
    NotificationModule,
    LogsModule,
    PromptModule,
    LlmUsageModule,
  ],
  controllers: [BugHunterController, BugHunterPipelineController],
  providers: [
    BugHuntSweepService,
    BugHuntRunRepository,
    BugHuntEventRepository,
    BugHunterSettingsRepository,
    BugFindingRepository,
    BugHunterNotificationRepository,
    BugHunterService,
    BugFindingService,
    BugHunterFinderDataService,
    GithubActionsService,
    BugHunterNotificationService,
    BugFixSessionService,
    BugHunterRepoClassifierService,
    BugFixSessionSchedulerRegistrationService,
  ],
  exports: [BugHunterService, BugFindingService, BugHunterNotificationService],
})
export class BugHunterModule {}
