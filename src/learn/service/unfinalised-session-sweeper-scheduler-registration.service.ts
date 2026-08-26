import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { ScenarioSessionService } from './scenario-session.service';
import { LoggerService } from '../../logger/logger.service';

/**
 * Registers the unfinalised-session sweep on the shared 30-minute scheduler.
 *
 * A roleplay's post-session lifecycle — `eventStatus = COMPLETED`, the
 * track/path/case item it completes, the practice minutes it adds to the
 * community leaderboard — is written from one place only: the agent's
 * `end-of-session` SQS message. That message is the most losable part of the
 * flow, and when it goes missing the learner is left with a session that
 * plainly happened (duration, transcript, summary, credits spent) but that the
 * platform never counted, with no way for them to see or fix it.
 *
 * THIRTY MINUTES, not hourly: unlike the stuck-session sweeper — whose six-hour
 * cutoff means nothing it finds is urgent — what this repairs is a learner
 * blocked on the next item of a track. Its own 15-minute grace period is what
 * keeps it from ever racing a session that is ending right now, so a tighter
 * tick costs one cheap indexed query and buys the learner their unlock in the
 * same sitting. Shares the lane with the actor-evaluation catch-up, which reads
 * the same rows for the same reason.
 *
 * Mirrors `StuckSessionSweeperSchedulerRegistrationService` and
 * `ActorEvaluationCatchupSchedulerRegistrationService`.
 */
@Injectable()
export class UnfinalisedSessionSweeperSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    UnfinalisedSessionSweeperSchedulerRegistrationService.name,
  );

  constructor(
    private readonly scenarioSessionService: ScenarioSessionService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('30min', 'unfinalised-session-sweep', () =>
      this.run(),
    );
  }

  private async run(): Promise<void> {
    const { found, finalised } =
      await this.scenarioSessionService.sweepUnfinalisedEndedSessions();
    // debug when there is nothing to say, so a healthy deployment does not log
    // a line every half hour; the service itself warns when it actually
    // repairs something.
    if (found === 0) {
      this.logger.debug('unfinalised-session sweep: nothing to finalise');
      return;
    }
    this.logger.info(
      `unfinalised-session sweep: found=${found} finalised=${finalised}`,
    );
  }
}
