import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { LanguageJudgeService } from './language-judge.service';
import { LoggerService } from '../../logger/logger.service';

/**
 * Registers the ongoing language-judge catch-up on the shared 30-minute
 * scheduler (sibling of the drift catch-up; see that service for rationale).
 *
 * Each tick enqueues a language backfill over the last day's sessions that are
 * NOT already judged (`onlyUnjudged=true`) — cheap and idempotent, so newly
 * completed sessions get evaluated and both read surfaces (session logs +
 * analytics) stay current without touching the session-end hot path.
 */
const LANGUAGE_CATCHUP_WINDOW_DAYS = 1;

@Injectable()
export class LanguageBackfillSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    LanguageBackfillSchedulerRegistrationService.name,
  );

  constructor(private readonly languageJudge: LanguageJudgeService) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register(
      '30min',
      'language-judge-catchup',
      async () => {
        const job = await this.languageJudge.startBackfill(
          LANGUAGE_CATCHUP_WINDOW_DAYS,
          true, // onlyUnjudged — judge only new sessions, never re-spend
        );
        this.logger.debug(`language-judge catch-up enqueued: job=${job.jobId}`);
      },
    );
  }
}
