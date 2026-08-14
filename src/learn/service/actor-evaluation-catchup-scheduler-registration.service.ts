import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { ScenarioSessionEvaluationService } from './scenario-session-evaluation.service';
import { LoggerService } from '../../logger/logger.service';

/**
 * Registers the actor-evaluation catch-up on the shared 30-minute scheduler.
 *
 * The actor goal judge only fires from the agent's `end-of-session` SQS
 * message, while the learner-facing summary fires from the separate
 * client/REST end path — so the two fail independently. Whenever the agent
 * never joins or the worker dies, the session gets a summary but is never
 * scored, and today nothing records that it was missed.
 *
 * Each tick re-scans the last day for ended sessions that have a transcript and
 * no `evaluationStatus` at all. Cheap and idempotent (the same guard runs again
 * inside the trigger), so it can overlap freely with the session-end path
 * without ever double-spending.
 *
 * Mirrors `DriftBackfillSchedulerRegistrationService`, which does the same for
 * the turn-level drift judge.
 */
@Injectable()
export class ActorEvaluationCatchupSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    ActorEvaluationCatchupSchedulerRegistrationService.name,
  );

  constructor(
    private readonly evaluationService: ScenarioSessionEvaluationService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('30min', 'actor-evaluation-catchup', () =>
      this.run(),
    );
  }

  private async run(): Promise<void> {
    const { found, triggered } = await this.evaluationService.runCatchup();
    this.logger.debug(
      `actor evaluation catch-up: found=${found} triggered=${triggered}`,
    );
  }
}
