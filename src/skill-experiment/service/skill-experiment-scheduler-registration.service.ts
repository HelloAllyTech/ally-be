import { Injectable, OnModuleInit } from '@nestjs/common';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import { SkillExperimentEngineService } from './skill-experiment-engine.service';

/**
 * Registers the auto-improve loop on the shared 5-minute bucket.
 *
 * The handler only KICKS the tick and returns: the tick makes LLM calls for
 * minutes at a time and the bucket runs its tasks in series, so awaiting it
 * would delay every other 5-minute job. The engine takes its own advisory lock
 * so one replica ticks at a time.
 *
 * On by default — an experiment only exists because an admin switched it on.
 * `SKILL_EXPERIMENTS_SCHEDULE=off` freezes every loop (live experiments keep
 * serving their current split; nothing is judged or drafted). Read on every
 * tick.
 */
@Injectable()
export class SkillExperimentSchedulerRegistrationService implements OnModuleInit {
  constructor(private readonly engine: SkillExperimentEngineService) {}

  static enabled(): boolean {
    const raw = (process.env.SKILL_EXPERIMENTS_SCHEDULE ?? 'on')
      .trim()
      .toLowerCase();
    return raw !== 'off' && raw !== 'false' && raw !== '0';
  }

  onModuleInit(): void {
    scheduledTaskRegistry.register('5min', 'skill-experiments', async () => {
      if (!SkillExperimentSchedulerRegistrationService.enabled()) return;
      this.engine.kick();
    });
  }
}
