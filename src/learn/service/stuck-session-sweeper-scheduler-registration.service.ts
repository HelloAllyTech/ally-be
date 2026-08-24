import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { ScenarioSessionService } from './scenario-session.service';
import { LoggerService } from '../../logger/logger.service';

/**
 * Registers the stuck-session sweeper on the shared hourly scheduler.
 *
 * A roleplay session leaves ACTIVE by exactly three routes — the learner's End
 * button, the agent's `end-of-session` SQS message, and the `room_finished`
 * webhook — and all three can be absent at once. An agent that never joined
 * publishes nothing, a learner who closed their laptop clicks nothing, and if
 * LiveKit never created the room there is no webhook either. The row then sat at
 * ACTIVE indefinitely: counting against the tenant's concurrent-simulation
 * ceiling, and reading on every operational view as a roleplay still in progress
 * days later.
 *
 * HOURLY, not every five minutes: the sweep's cutoff is six hours, so nothing it
 * can find is urgent, and an hourly tick keeps a cheap indexed query off the
 * five-minute lane that the reconcile tasks share.
 *
 * Mirrors `ActorEvaluationCatchupSchedulerRegistrationService`.
 */
@Injectable()
export class StuckSessionSweeperSchedulerRegistrationService
  implements OnModuleInit
{
  private readonly logger = LoggerService.getInstance(
    StuckSessionSweeperSchedulerRegistrationService.name,
  );

  constructor(
    private readonly scenarioSessionService: ScenarioSessionService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('hourly', 'stuck-session-sweep', () =>
      this.run(),
    );
  }

  private async run(): Promise<void> {
    const { found, abandoned } =
      await this.scenarioSessionService.sweepStuckActiveSessions();
    // debug when there is nothing to say, so a healthy deployment does not log
    // an hourly line forever; the service itself warns when it actually reaps.
    if (found === 0) {
      this.logger.debug('stuck-session sweep: nothing stuck');
      return;
    }
    this.logger.info(
      `stuck-session sweep: found=${found} abandoned=${abandoned}`,
    );
  }
}
