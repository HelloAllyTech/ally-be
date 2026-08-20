import { Injectable, OnModuleInit } from '@nestjs/common';

import { LoggerService } from '../../logger/logger.service';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { LanguageGlossaryService } from './language-glossary.service';
import { GLOSSARY_CONSOLIDATION_DIMENSIONS } from '../constants/glossary.constants';

/**
 * The RSI loop's clock: registers glossary consolidation on the shared
 * 30-minute scheduler, gated so it actually runs per language only when
 * either trigger fires ("every n days OR when enough data is in"):
 *   - interval: the last batch is older than GLOSSARY_CONSOLIDATE_INTERVAL_HOURS
 *     (default 24) and at least one unconsumed annotation exists, or
 *   - data threshold: unconsumed non-test style annotations reach
 *     GLOSSARY_CONSOLIDATE_MIN_ANNOTATIONS (default 25) regardless of age.
 *
 * Mode comes from GLOSSARY_CONSOLIDATION_SCHEDULE:
 *   - 'off'      (default): scheduler is a no-op — deploys change nothing
 *                until the flag is set deliberately.
 *   - 'propose'  : scheduled runs create proposals for human review.
 *   - 'auto'     : scheduled runs auto-accept + publish (full RSI mode);
 *                safety = dedupe, Tier 0 cap, batch rollback.
 */
@Injectable()
export class GlossaryConsolidationSchedulerRegistrationService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(
    GlossaryConsolidationSchedulerRegistrationService.name,
  );

  constructor(private readonly glossaryService: LanguageGlossaryService) {}

  private mode(): 'off' | 'propose' | 'auto' {
    const raw = (process.env.GLOSSARY_CONSOLIDATION_SCHEDULE ?? 'off')
      .trim()
      .toLowerCase();
    return raw === 'auto' ? 'auto' : raw === 'propose' ? 'propose' : 'off';
  }

  private intervalHours(): number {
    const parsed = parseInt(
      process.env.GLOSSARY_CONSOLIDATE_INTERVAL_HOURS ?? '24',
      10,
    );
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
  }

  private minAnnotations(): number {
    const parsed = parseInt(
      process.env.GLOSSARY_CONSOLIDATE_MIN_ANNOTATIONS ?? '25',
      10,
    );
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 25;
  }

  onModuleInit(): void {
    scheduledTaskRegistry.register(
      '30min',
      'glossary-consolidation',
      async () => {
        const mode = this.mode();
        if (mode === 'off') return;
        await this.tick(mode);
      },
    );
  }

  /** Exposed for tests; one scheduler pass over every candidate language. */
  async tick(mode: 'propose' | 'auto'): Promise<void> {
    const candidates = await this.candidateLanguageIds();
    for (const languageId of candidates) {
      try {
        const unconsumed =
          await this.glossaryService.countUnconsumedAnnotations(languageId);
        if (unconsumed === 0) continue;
        const dataTrigger = unconsumed >= this.minAnnotations();
        const intervalTrigger = await this.intervalElapsed(languageId);
        if (!dataTrigger && !intervalTrigger) continue;

        const result = await this.glossaryService.consolidateGlossary(
          languageId,
          'scheduler',
          { autoAccept: mode === 'auto', trigger: 'scheduled' },
        );
        this.logger.debug(
          `glossary-consolidation language=${languageId} mode=${mode} ` +
            `trigger=${dataTrigger ? 'data' : 'interval'} ` +
            `proposed=${result.proposed} autoAccepted=${result.autoAccepted} batch=${result.batchId}`,
        );
      } catch (error) {
        // Per-language isolation: one failing language never starves the rest.
        this.logger.error(
          `glossary-consolidation failed for language=${languageId}: ${(error as Error).message}`,
        );
      }
    }
  }

  /** Languages with recent style-dimension annotations (90d), by id. */
  private async candidateLanguageIds(): Promise<number[]> {
    const rows: { id: number }[] =
      await this.glossaryService.queryCandidateLanguages([
        ...GLOSSARY_CONSOLIDATION_DIMENSIONS,
      ]);
    return rows.map((r) => r.id);
  }

  private async intervalElapsed(languageId: number): Promise<boolean> {
    const [latest] =
      await this.glossaryService.listConsolidationBatches(languageId);
    if (!latest) return true;
    const ageMs = Date.now() - new Date(latest.createdAt).getTime();
    return ageMs >= this.intervalHours() * 3600_000;
  }
}
