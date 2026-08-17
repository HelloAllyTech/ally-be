import { Injectable, OnModuleInit } from '@nestjs/common';

import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';

import { BugFixSessionService } from './bug-fix-session.service';

@Injectable()
export class BugFixSessionSchedulerRegistrationService implements OnModuleInit {
  constructor(private readonly bugFixSessionService: BugFixSessionService) {}

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
  }
}
