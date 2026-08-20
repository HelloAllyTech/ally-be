import { Injectable, OnModuleInit } from '@nestjs/common';

import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { GlossaryAdherenceService } from './glossary-adherence.service';

/**
 * Registers the glossary-adherence catch-up on the shared 30-minute scheduler.
 *
 * Sibling of the drift and language-judge catch-ups, with one difference worth
 * stating: those exist because judging is expensive and must stay off the
 * session-end path. This one exists because the scan was added to session end
 * only in August, so 664 eligible sessions from before that were never scanned
 * — leaving the adherence signal readable on 1.5% of eligible sessions while it
 * was the one measurement that distinguishes "the glossary is wrong" from "the
 * glossary is not being followed".
 *
 * Forward coverage is already fine (10 of the 11 eligible sessions since the
 * auto-scan shipped were scanned), so this is a backlog drain that then idles:
 * each tick takes only sessions with no report, so once history is covered a
 * tick selects nothing and costs one query.
 *
 * No model call — the scan is deterministic avoid-term matching — so this
 * competes for nothing that the judges need.
 */
@Injectable()
export class GlossaryAdherenceSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    GlossaryAdherenceSchedulerRegistrationService.name,
  );

  constructor(private readonly adherence: GlossaryAdherenceService) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register(
      '30min',
      'glossary-adherence-catchup',
      async () => {
        const result = await this.adherence.catchUpUnscanned();
        if (result.scanned > 0) {
          this.logger.debug(
            `glossary-adherence catch-up: scanned=${result.scanned} ` +
              `reported=${result.reported} skipped=${result.skipped}`,
          );
        }
      },
    );
  }
}
