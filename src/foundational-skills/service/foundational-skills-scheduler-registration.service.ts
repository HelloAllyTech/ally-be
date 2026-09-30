import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import { LoggerService } from 'src/logger/logger.service';
import { FoundationalSkillsService } from './foundational-skills.service';

/**
 * Registers the foundational-skills measure on the shared 30-minute bucket.
 *
 * Each tick seals any cuts newly completed practice allows, then scores a
 * bounded batch of unscored cuts — so the history backfills in capped chunks on
 * first deploy and afterwards keeps pace with practice. The bucket's advisory
 * lock means one replica runs it.
 *
 * On by default. `FOUNDATIONAL_SKILLS_SCHEDULE=off` stops both halves (read on
 * every tick, so no redeploy is needed to change it once the env is reloaded).
 */
@Injectable()
export class FoundationalSkillsSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    FoundationalSkillsSchedulerRegistrationService.name,
  );

  constructor(private readonly service: FoundationalSkillsService) {}

  static enabled(): boolean {
    const raw = (process.env.FOUNDATIONAL_SKILLS_SCHEDULE ?? 'on')
      .trim()
      .toLowerCase();
    return raw !== 'off' && raw !== 'false' && raw !== '0';
  }

  onModuleInit(): void {
    scheduledTaskRegistry.register('30min', 'foundational-skills', async () => {
      if (!FoundationalSkillsSchedulerRegistrationService.enabled()) return;
      try {
        await this.service.tick();
      } catch (error) {
        this.logger.error(
          `foundational-skills tick failed: ${(error as Error)?.message ?? error}`,
        );
      }
    });
  }
}
