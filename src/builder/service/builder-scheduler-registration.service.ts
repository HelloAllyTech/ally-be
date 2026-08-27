import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import { BuilderBuildService } from './builder-build.service';
import { BuilderPullRequestService } from './builder-pull-request.service';
import { BuilderOutcomeService } from './builder-outcome.service';
import { BuilderLessonCuratorService } from './builder-lesson-curator.service';
import {
  BUILDER_CURATE_INTERVAL,
  BUILDER_CURATE_TASK,
  BUILDER_OUTCOME_INTERVAL,
  BUILDER_OUTCOME_TASK,
  BUILDER_RECONCILE_INTERVAL,
  BUILDER_RECONCILE_TASK,
} from '../constants/builder.constants';

@Injectable()
export class BuilderSchedulerRegistrationService implements OnModuleInit {
  constructor(
    private readonly buildService: BuilderBuildService,
    private readonly pullRequestService: BuilderPullRequestService,
    private readonly outcomeService: BuilderOutcomeService,
    private readonly curatorService: BuilderLessonCuratorService,
  ) {}

  onModuleInit(): void {
    // `workflow_dispatch` answers 204 with no run id, so nothing about a
    // dispatched run is known at request time. This tick closes that loop:
    // it attaches the run id and URL once GitHub registers them, settles a
    // run whose callbacks never arrived, and times out one that went quiet.
    //
    // 5min rather than anything tighter because a build takes tens of
    // minutes and every tick costs GitHub API calls against a shared rate
    // limit. It no-ops entirely when nothing is in flight.
    scheduledTaskRegistry.register(
      BUILDER_RECONCILE_INTERVAL,
      BUILDER_RECONCILE_TASK,
      () => this.buildService.reconcile(),
    );

    // The interesting half of a pull request's life happens after Builder
    // stops watching — CI runs, someone reviews, someone merges. Without this
    // the session view would say "opened" forever, which is exactly the state
    // an admin checks back on and mistrusts.
    scheduledTaskRegistry.register(
      BUILDER_RECONCILE_INTERVAL,
      'builder-pr-reconcile',
      () => this.pullRequestService.reconcileOpenPullRequests(),
    );

    // The flywheel's catch-up. Merge and settle hooks do most of the work;
    // this exists because a hook that failed, or a PR merged while the
    // service was down, would otherwise leave a build's outcome permanently
    // unlearned — and an outcome nobody records is a build nobody learns from.
    scheduledTaskRegistry.register(
      BUILDER_OUTCOME_INTERVAL,
      BUILDER_OUTCOME_TASK,
      () => this.outcomeService.sweep().then(() => undefined),
    );

    // Fold new candidate lessons into the curated set. Separate from the
    // sweep so a batch harvested by a merge hook is still curated on a
    // predictable cadence; no-ops on one COUNT when there is nothing new.
    scheduledTaskRegistry.register(
      BUILDER_CURATE_INTERVAL,
      BUILDER_CURATE_TASK,
      () => this.curatorService.consolidate().then(() => undefined),
    );
  }
}
