import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import { LoggerService } from 'src/logger/logger.service';
import { FEEDBACK_SKILL_MAPPING_SCHEDULE_ENV } from '../constants/feedback-skill-mapper.constants';
import { FeedbackSkillMappingService } from './feedback-skill-mapping.service';

/**
 * Registers the feedback → skill mapping on the shared 30-minute bucket, beside
 * the foundational-skills measure whose output it waits on (it only maps
 * debriefs of learners who already have a scored cut).
 *
 * OFF by default, in every environment: the job makes model calls on a
 * schedule, so an environment opts in. Set
 * `FEEDBACK_SKILL_MAPPING_SCHEDULE=on` (also `true` / `1`) to run it; read on
 * every tick, so once the env is reloaded no redeploy is needed. The bucket's
 * advisory lock means one replica runs it.
 */
@Injectable()
export class FeedbackSkillMappingSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    FeedbackSkillMappingSchedulerRegistrationService.name,
  );

  constructor(private readonly service: FeedbackSkillMappingService) {}

  static enabled(): boolean {
    const raw = (process.env[FEEDBACK_SKILL_MAPPING_SCHEDULE_ENV] ?? 'off')
      .trim()
      .toLowerCase();
    return raw === 'on' || raw === 'true' || raw === '1';
  }

  /** One scheduled run. Exposed for tests; a no-op while the flag is off. */
  async run(): Promise<void> {
    if (!FeedbackSkillMappingSchedulerRegistrationService.enabled()) return;
    try {
      await this.service.tick();
    } catch (error) {
      this.logger.error(
        `feedback-skill-mapping tick failed: ${(error as Error)?.message ?? error}`,
      );
    }
  }

  onModuleInit(): void {
    scheduledTaskRegistry.register('30min', 'feedback-skill-mapping', () =>
      this.run(),
    );
  }
}
