import { Injectable, OnModuleInit } from '@nestjs/common';

import {
  AGENT_MEMORY_RETIRE_INTERVAL,
  AGENT_MEMORY_RETIRE_TASK,
} from 'src/agent-memory/constants/agent-memory.constants';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';

import {
  BUG_HUNT_STALE_ESCALATION_AFTER_MS,
  BUG_HUNT_STALE_ESCALATION_QUIET_MS,
} from '../constants/bug-hunter.constants';
import { BugFindingService } from './bug-finding.service';
import { BugFixSessionService } from './bug-fix-session.service';
import { BugHunterService } from './bug-hunter.service';
import { BugHunterMemoryRetirementService } from './bug-hunter-memory-retirement.service';
import { BugHunterFinderService } from './bug-hunter-finder.service';
import {
  BUG_HUNT_PROTECTION_DRIFT_TASK,
  BugHunterProtectionDriftService,
} from './bug-hunter-protection-drift.service';
import { BugHunterOrchestratorService } from './bug-hunter-orchestrator.service';
import { BugVerifyFixService } from './bug-verify-fix.service';
import { BUG_HUNT_PR_RECONCILE_TASK } from '../type/bug-hunter-orchestrator.type';
import { BUG_HUNT_PR_REVIEW_TASK } from '../type/bug-hunter-pr-review.type';
import { BugHunterPrReviewService } from './bug-hunter-pr-review.service';

@Injectable()
export class BugFixSessionSchedulerRegistrationService implements OnModuleInit {
  constructor(
    private readonly bugFixSessionService: BugFixSessionService,
    private readonly bugFindingService: BugFindingService,
    private readonly bugHunterService: BugHunterService,
    private readonly memoryRetirement: BugHunterMemoryRetirementService,
    private readonly finderService: BugHunterFinderService,
    private readonly protectionDrift: BugHunterProtectionDriftService,
    private readonly orchestrator: BugHunterOrchestratorService,
    private readonly verifyFix: BugVerifyFixService,
    private readonly prReview: BugHunterPrReviewService,
  ) {}

  onModuleInit(): void {
    // Both halves of the on-demand path dispatch a GitHub workflow, and
    // `workflow_dispatch` answers 204 with no run id — so nothing about what
    // happens next is known at request time. This tick is what closes the
    // loop: it attaches run URLs once GitHub registers them, promotes
    // RELEASING to RELEASED/RELEASE_FAILED from the run's own conclusion, and
    // times out a session that never reported in.
    //
    // 5min rather than anything tighter because the things it watches take
    // minutes to tens of minutes (ally-be's release alone runs tests, a Docker
    // build, a prod DB migration and an ECS rollout), and every tick costs
    // GitHub API calls against a shared rate limit. It no-ops entirely when
    // nothing is in flight.
    scheduledTaskRegistry.register('5min', 'bug-fix-session-reconcile', () =>
      this.bugFixSessionService.reconcile(),
    );
    // Runs had no reconcile pass at all, unlike findings: a job GitHub
    // cancelled at its timeout left its run RUNNING forever, and the card
    // said "Working" for days. Same cadence, same reasoning — see
    // BugHunterService.reconcileStaleRuns.
    scheduledTaskRegistry.register(
      '5min',
      'bug-hunt-run-reconcile',
      async () => {
        await this.bugHunterService.reconcileStaleRuns();
      },
    );

    // The inbox is pull-only on purpose — no email, no push, Slack removed —
    // which is fine while someone is looking at the tab and not fine for a
    // question an unattended 2am sweep asked. Without this, that question sits
    // unread indefinitely and the bug stops moving with nobody aware it is
    // waiting on them. Hourly so it notices promptly; at most one message a
    // day, and none at all when nothing is waiting.
    // The notebook's subtractive half (OPP-0752). The hourly curator only
    // ever folds new lessons in; this is what takes a stale one out, by
    // evidence, with the reason written on the row. Daily, because a day's
    // worth of run feedback is the smallest unit that moves the counters it
    // reads, and nightly sweeps are when the counters move.
    scheduledTaskRegistry.register(
      AGENT_MEMORY_RETIRE_INTERVAL,
      AGENT_MEMORY_RETIRE_TASK,
      async () => {
        await this.memoryRetirement.run();
      },
    );

    // The Finder's event triggers (OPP-0781): a light pass after a merge or
    // a human report, debounced per repo, so lead time is hours rather than
    // a night.
    scheduledTaskRegistry.register('5min', 'bug-finder-event-triggers', () =>
      this.finderService.runEventTriggers(),
    );

    // Open fix PRs (OPP-0758): a conflicted PR goes back to a session to
    // rebase, a stale one gets its branch updated, and a head nobody has
    // judged gets a Verifier. Same cadence as the other reconciles.
    scheduledTaskRegistry.register(
      '5min',
      BUG_HUNT_PR_RECONCILE_TASK,
      async () => {
        await this.orchestrator.reconcileOpenPullRequests();
        await this.verifyFix.reconcileOpenPrs();
      },
    );

    // The PR review sense (OPP-0785): every open pull request a person
    // pushed gets one review run per head, within five minutes.
    scheduledTaskRegistry.register(
      '5min',
      BUG_HUNT_PR_REVIEW_TASK,
      async () => {
        await this.prReview.poll();
      },
    );

    // Does master protection still match the repo map (OPP-0759)? Daily,
    // one Problem notice per repo when the answer changes.
    scheduledTaskRegistry.register(
      'daily',
      BUG_HUNT_PROTECTION_DRIFT_TASK,
      async () => {
        await this.protectionDrift.run();
      },
    );

    scheduledTaskRegistry.register(
      'hourly',
      'bug-hunter-stale-escalation-digest',
      async () => {
        await this.bugFindingService.raiseStaleEscalationDigest(
          BUG_HUNT_STALE_ESCALATION_AFTER_MS,
          BUG_HUNT_STALE_ESCALATION_QUIET_MS,
        );
      },
    );
  }
}
